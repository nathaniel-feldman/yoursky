// Fixed students used by the engine parity test and its baseline generator.
import { createHash } from 'node:crypto';
const base = { name: '', gpa: null, testMode: 'sat', sat: null, act: null, major: null, major2: null, budget: null, dorm: true, region: null, state: null };

export const CASES = [
  { id: 'empty', P: { ...base }, A: {}, income: null },
  {
    id: 'cs-ca-strong',
    P: { ...base, name: 'Ava', gpa: 3.9, sat: 1500, major: 'cs', major2: 'engineering', region: 'pc', state: 'CA' },
    A: { setting: 'city', size: 70, distance: 20, weather: 'sun', curriculum: 'dist', vibe: 60, social: ['game', 'arts'], track: 30, activities: ['hackathons', 'research', 'startups'], followup: 'startup' },
    income: 2,
  },
  {
    id: 'bio-ny-act',
    P: { ...base, gpa: 3.4, testMode: 'act', act: 27, major: 'bio', region: 'ne', state: 'NY' },
    A: { setting: 'town', size: 25, distance: 80, weather: 'seasons', curriculum: 'open', vibe: 20, social: ['chill'], track: 80, activities: ['service', 'music'], followup: 'hospital' },
    income: 0,
  },
  {
    id: 'biz-tx-budget',
    P: { ...base, gpa: 3.1, sat: 1180, major: 'business', region: 'sc', state: 'TX', budget: 25000 },
    A: { setting: 'suburb', size: 95, distance: 5, weather: 'mild', curriculum: 'hands', vibe: 85, social: ['greek', 'game'], track: 50, activities: ['varsity', 'gameday', 'greek'], followup: 'school' },
    income: 4,
  },
  {
    id: 'undecided-intl',
    P: { ...base, gpa: 3.7, testMode: 'none', major: 'undecided', region: 'intl' },
    A: { setting: 'rural', size: 5, distance: 100, weather: 'snow', curriculum: 'core', vibe: 40, social: ['outdoors'], track: 10, activities: ['outdoors', 'ski'], followup: 'freedom' },
    income: null,
  },
  {
    id: 'humanities-not-dorm',
    P: { ...base, gpa: 2.8, sat: 1010, major: 'english', major2: 'history', region: 'mw', state: 'IL', dorm: false },
    A: { setting: 'city', size: 50, distance: 0, weather: 'seasons', curriculum: 'core', vibe: 50, social: [], track: 50, activities: [] },
    income: 1,
  },
];

// Everything the engine computes for each case, as plain data.
export function snapshot(E, CFG, schools, cases) {
  const out = { cases: [] };
  for (const c of cases) {
    const rows = schools.map((s) => {
      const r = E.score(s, c.P, c.A, c.income);
      return {
        id: s.id,
        fit: r.fit,
        parts: r.parts.map((p) => [p.key, p.label, p.w, p.v, p.why ?? null, p.warn ?? null]),
        chance: r.chance,
        cost: r.cost,
        dist: r.dist,
        explain: E.explain(s, r),
        deadlines: E.deadlinesOf(s).map((d) => [d.type, d.name, d.binding ?? null, d.date ? [d.date.getMonth() + 1, d.date.getDate()] : null]),
      };
    });
    out.cases.push({ id: c.id, rows });
  }
  const st = (i) => ({ profile: cases[i].P, answers: cases[i].A, kept: out.cases[i].rows.slice(0, 6).map((r) => r.id) });
  const encoded = E.encodeShare(st(1));
  const decoded = E.decodeShare(encoded);
  out.share = { encoded, decoded, bad: E.decodeShare('not-base64!'), wrongVersion: E.decodeShare(btoa('{"v":2,"k":[]}')) };
  out.compat = [E.compat(st(2), decoded, schools), E.compat(st(3), decoded, schools), E.compat(st(1), decoded, schools)];
  out.misc = {
    milesOf: [0, 10, 25, 50, 75, 95, 100].map(E.milesOf),
    satOf: [{ testMode: 'sat', sat: 1400 }, { testMode: 'act', act: 31 }, { testMode: 'act', act: null }, { testMode: 'none', sat: 1400 }].map(E.satOf),
    money: [null, 0, 950, 12345, 99999, 100000, 250500].map(E.money),
    cycleYear: [new Date(2026, 0, 15), new Date(2026, 1, 28), new Date(2026, 2, 1), new Date(2026, 9, 7)].map((d) => E.cycleYear(d)),
    locGroup: [null, 11, 12, 13, 21, 23, 31, 33, 41, 43].map(E.locGroup),
    questions: CFG.QUESTIONS.map((q) => q.id),
  };
  return out;
}

// Shrinks a snapshot for storage: every row keeps fit, category and estimate in the clear plus a hash of
// its full detail; the first few rows per case keep everything so a failure is easy to read.
const FULL_ROWS = 8;
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
export function compact(snap) {
  return {
    ...snap,
    cases: snap.cases.map((c) => ({
      id: c.id,
      rows: c.rows.map((r, i) => (i < FULL_ROWS ? r : { id: r.id, fit: r.fit, cat: r.chance.cat, est: r.cost.est, h: hash(r) })),
    })),
  };
}
