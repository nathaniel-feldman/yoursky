// Server-side sky: ranks schools with the same engine the browser uses, then decides what this caller may see.
//
//   Everyone:            how many hidden matches exist in the expanded pool, and their fit scores (no identities).
//   Signed in, free:     chances, real cost and earnings for their #1 curated school (the one free reveal).
//   Pro:                 the hidden schools in full, plus chances, real cost and earnings for their top curated
//                        schools and any school ids they ask about.
import { ENGINE } from './app/engine.js';
import { CFG } from './app/config.js';
import { estimateChance } from './chances.js';
import { json, readJson } from './http.js';

export const HIDDEN_COUNT = 3;
export const PRO_DETAIL_COUNT = 40;

const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const pick = (v, allowed) => (typeof v === 'string' && allowed.has(v) ? v : null);
const MAJOR_IDS = new Set(CFG.MAJORS.map((m) => m.id));
const REGION_IDS = new Set(CFG.REGIONS.map((r) => r.id));
const STATE_IDS = new Set(Object.keys(CFG.STATES));
const ACTIVITY_IDS = new Set(CFG.ACTIVITIES.map((a) => a.id));
const FOLLOWUP_IDS = new Set(Object.values(CFG.FOLLOWUPS).flatMap((f) => f.options.map((o) => o.v)));

// Accepts only the profile fields and answer shapes the quiz produces; everything else is dropped.
export function cleanInput(body) {
  const p = body?.profile ?? {};
  const testMode = pick(p.testMode, new Set(['sat', 'act', 'none'])) ?? 'none';
  const profile = {
    name: '', dorm: true,
    gpa: num(p.gpa, 0, 4),
    testMode,
    sat: num(p.sat, 400, 1600),
    act: num(p.act, 1, 36),
    major: pick(p.major, MAJOR_IDS),
    major2: pick(p.major2, MAJOR_IDS),
    region: pick(p.region, REGION_IDS),
    state: pick(p.state, STATE_IDS),
    budget: num(p.budget, 0, 200_000),
  };
  const answers = {};
  const a = body?.answers ?? {};
  for (const q of CFG.QUESTIONS) {
    const v = a[q.id];
    if (v == null) continue;
    if (q.type === 'slider') { if (num(v, 0, 100) != null) answers[q.id] = v; }
    else if (q.id === 'followup') { if (pick(v, FOLLOWUP_IDS)) answers[q.id] = v; }
    else if (q.type === 'tap') { if (pick(v, new Set(q.options.map((o) => o.v)))) answers[q.id] = v; }
    else if (q.type === 'multi' || q.type === 'chips') {
      const allowed = q.type === 'chips' ? ACTIVITY_IDS : new Set(q.options.map((o) => o.v));
      if (Array.isArray(v)) answers[q.id] = [...new Set(v.filter((x) => pick(x, allowed)))].slice(0, q.max ?? 5);
    }
  }
  const income = Number.isInteger(body?.income) && body.income >= 0 && body.income <= 4 ? body.income : null;
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => Number.isInteger(x)).slice(0, 60) : [];
  return { profile, answers, income, ids };
}

function studentScores(P) {
  return { gpa: P.gpa, sat: P.testMode === 'sat' ? P.sat : null, act: P.testMode === 'act' ? P.act : null };
}

// Chances, real cost and earnings for one school.
export function detailFor(s, P, income) {
  const c = ENGINE.costOf(s, P, income);
  const byIncome = income != null && Array.isArray(s.nbi) && s.nbi[income] != null;
  return {
    id: s.id,
    chance: estimateChance(s, studentScores(P), CFG.ACT_TO_SAT),
    cost: {
      // Scorecard reports negative net prices when grants exceed the cost; show those as $0.
      net: Math.max(0, c.est),
      sticker: c.sticker,
      basis: P.region === 'intl' ? 'international' : byIncome ? 'income' : s.net != null ? 'average' : 'estimate',
      grantsExceedCost: c.est < 0,
      inState: c.inState,
    },
    earnings: s.earn ?? null,
  };
}

/**
 * @param {{ curated: object[], pool: object[], input: ReturnType<typeof cleanInput>, isPro: boolean, signedIn: boolean }} args
 *   School records are in the app's compact format with the Pro fields (nbi, earn) merged in.
 */
export function computeSky({ curated, pool, input, isPro, signedIn }) {
  const { profile: P, answers: A, income, ids } = input;
  const rank = (list) => list.map((s) => ({ s, fit: ENGINE.score(s, P, A, income).fit })).sort((a, b) => b.fit - a.fit);
  const ranked = rank(curated);
  const hidden = rank(pool).filter((x) => x.fit > 0).slice(0, HIDDEN_COUNT);
  const top = ranked[0];

  if (!isPro) {
    return {
      pro: false,
      hidden: { count: hidden.length, fits: hidden.map((x) => x.fit) },
      reveal: signedIn && top ? detailFor(top.s, P, income) : null,
    };
  }

  const byId = new Map(curated.map((s) => [s.id, s]));
  const want = new Set([...ranked.slice(0, PRO_DETAIL_COUNT).map((x) => x.s.id), ...ids.filter((id) => byId.has(id))]);
  return {
    pro: true,
    hidden: hidden.map((x) => ({ school: x.s, fit: x.fit, ...detailFor(x.s, P, income) })),
    details: Object.fromEntries([...want].map((id) => [id, detailFor(byId.get(id), P, income)])),
    ranked: ranked.slice(0, PRO_DETAIL_COUNT).map((x) => ({ id: x.s.id, fit: x.fit })),
  };
}

/**
 * POST /sky with { profile, answers, income, ids }.
 * @param {{ resolveUser: (req: Request) => Promise<{ id: string } | null>, isProUser: (id: string) => Promise<boolean>, loadSchools: () => Promise<{ curated: object[], pool: object[] }> }} deps
 */
export function makeSkyHandler({ resolveUser, isProUser, loadSchools }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    let body;
    try {
      body = await readJson(req);
    } catch (e) {
      return json({ error: e.message }, e.status ?? 400);
    }
    const user = await resolveUser(req);
    const [isPro, schools] = await Promise.all([user ? isProUser(user.id) : false, loadSchools()]);
    return json(computeSky({ ...schools, input: cleanInput(body), isPro, signedIn: !!user }));
  };
}

/** POST /account-delete: deletes the caller's auth user; the database cascades to profile, skies and friendships. */
export function makeDeleteHandler({ resolveUser, deleteUser }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const user = await resolveUser(req);
    if (!user) return json({ error: 'sign in first' }, 401);
    await deleteUser(user.id);
    return json({ ok: true });
  };
}
