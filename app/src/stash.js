// The anonymous sky, kept in this browser so it survives a sign-in redirect and can be saved to an account afterwards.
// Lives only in localStorage on the student's own device; cleared once it's saved.
export const STASH_KEY = 'yoursky.sky.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function saveStash(storage, S, now = Date.now()) {
  const rec = { v: 1, at: now, profile: { ...S.profile }, answers: S.answers, kept: S.kept, passed: S.passed, income: S.income };
  try { storage.setItem(STASH_KEY, JSON.stringify(rec)); } catch {}
  return rec;
}

export function loadStash(storage, now = Date.now()) {
  try {
    const r = JSON.parse(storage.getItem(STASH_KEY) || 'null');
    if (!r || r.v !== 1 || now - r.at > MAX_AGE_MS || !Array.isArray(r.kept) || typeof r.answers !== 'object') return null;
    return r;
  } catch {
    return null;
  }
}

export function clearStash(storage) {
  try { storage.removeItem(STASH_KEY); } catch {}
}

// What may be stored with a saved sky (and seen by friends): no grades, scores, budget, income or home state.
export function snapshotOf(profile) {
  const out = {};
  if (profile.name) out.name = String(profile.name).slice(0, 24);
  for (const k of ['major', 'major2', 'region']) if (profile[k]) out[k] = profile[k];
  return out;
}
