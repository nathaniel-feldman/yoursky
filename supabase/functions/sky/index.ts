// Gated sky data: hidden planets, chances, real cost and earnings. Decides what to return from is_pro on the server.
import { makeSkyHandler } from '../_shared/sky.js';
import { corsFor, withCors } from '../_shared/http.js';
import { admin, resolveUser } from '../_shared/supabase.ts';

type School = Record<string, unknown> & { id: number };
let cache: { at: number; curated: School[]; pool: School[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

// All schools with their Pro fields merged in, cached per warm instance. PostgREST returns at most 1000 rows per
// request, so this pages through.
async function loadSchools() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  type Pro = { data: Record<string, unknown> };
  const rows: { curated: boolean; data: School; school_pro: Pro | Pro[] | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from('schools')
      .select('curated, data, school_pro(data)')
      .order('unitid')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as unknown as typeof rows));
    if (data.length < 1000) break;
  }
  // One-to-one embeds come back as an object; be tolerant of an array too.
  const proOf = (r: (typeof rows)[number]) => (Array.isArray(r.school_pro) ? r.school_pro[0] : r.school_pro)?.data ?? {};
  const merged = rows.map((r) => ({ row: r, s: { ...r.data, ...proOf(r) } as School }));
  cache = { at: Date.now(), curated: merged.filter((x) => x.row.curated).map((x) => x.s), pool: merged.filter((x) => !x.row.curated).map((x) => x.s) };
  return cache;
}

async function isProUser(id: string) {
  const { data, error } = await admin.from('profiles').select('is_pro').eq('id', id).maybeSingle();
  if (error) throw error;
  return data?.is_pro === true;
}

Deno.serve(withCors(corsFor(Deno.env.get('ALLOWED_ORIGINS') ?? ''), makeSkyHandler({ resolveUser, isProUser, loadSchools })));
