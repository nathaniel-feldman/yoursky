// scripts/import_supabase.py output must fit the real schema, and the sky function must be able to use it.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { freshDb } from './harness.js';
import { computeSky, cleanInput } from '../../supabase/functions/_shared/sky.js';

const dump = () => JSON.parse(execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, 'scripts')
import import_supabase as m
d = json.load(open(m.CURATED))
s, p = m.rows_for(d['schools'], True, d['asOf'])
pool_s, pool_p = m.rows_for(d['schools'][:5], False, d['asOf'])
for r in pool_s + pool_p: r['unitid'] += 9000000
for r in pool_s: r['data'] = dict(r['data'], id=r['unitid'])
print(json.dumps({'schools': s + pool_s, 'pro': p + pool_p}))
`], { encoding: 'utf8', maxBuffer: 1 << 26 }));

describe('Scorecard import', () => {
  it('fits the schema, keeps Pro fields out of the public table, and feeds the sky function', async () => {
    const db = await freshDb();
    const { schools, pro } = dump();
    await db.admin(`insert into public.schools select * from jsonb_populate_recordset(null::public.schools, $1)`, [JSON.stringify(schools)]);
    await db.admin(`insert into public.school_pro select * from jsonb_populate_recordset(null::public.school_pro, $1)`, [JSON.stringify(pro)]);
    const counts = (await db.admin('select curated, count(*)::int as n from public.schools group by curated order by curated')).rows;
    expect(counts).toEqual([{ curated: false, n: 5 }, { curated: true, n: 203 }]);

    const leaked = (await db.admin(`select count(*)::int as n from public.schools where data ? 'nbi' or data ? 'earn'`)).rows[0].n;
    expect(leaked).toBe(0);

    // Clients see curated rows only, never the pool or Pro fields.
    expect((await db.anon((q) => q('select count(*)::int as n from public.schools'))).rows[0].n).toBe(203);

    // Same merge the deployed function does (sky/index.ts), then a Pro computation over it.
    const rows = (await db.service((q) => q('select s.curated, s.data, p.data as pro from public.schools s left join public.school_pro p using (unitid)'))).rows;
    const merged = rows.map((r) => ({ curated: r.curated, s: { ...r.data, ...(r.pro || {}) } }));
    const sky = computeSky({
      curated: merged.filter((x) => x.curated).map((x) => x.s),
      pool: merged.filter((x) => !x.curated).map((x) => x.s),
      input: cleanInput({ profile: { gpa: 3.6, testMode: 'sat', sat: 1350, region: 'mw', state: 'IL' }, answers: { size: 50 }, income: 2 }),
      isPro: true, signedIn: true,
    });
    expect(sky.hidden).toHaveLength(3);
    expect(sky.hidden.every((h) => h.school.id > 9_000_000)).toBe(true);
    expect(Object.values(sky.details).some((d) => d.cost.basis === 'income' && d.earnings > 0)).toBe(true);
  });
});
