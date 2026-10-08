// Creator attribution: the first ?aff= / ?ref= / ?code= a visitor arrives with is remembered for 30 days, then written
// to their profile at sign-up and passed to checkout. ?code= is also a discount code, pre-applied at checkout.
export const REF_KEY = 'yoursky.ref';
export const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLEAN = /^[A-Za-z0-9_-]{1,64}$/;

function read(storage) {
  try {
    return JSON.parse(storage.getItem(REF_KEY) || 'null');
  } catch {
    return null;
  }
}

/** Stored attribution, or null when there is none or it has expired. */
export function getReferral(storage, now = Date.now()) {
  const r = read(storage);
  if (!r || typeof r.at !== 'number' || now - r.at > REF_TTL_MS) {
    if (r) try { storage.removeItem(REF_KEY); } catch {}
    return null;
  }
  return { ref: r.ref || null, discount: r.discount || null, at: r.at };
}

/** Reads attribution params from a URL. First touch wins: an unexpired earlier value is kept. */
export function captureReferral(href, storage, now = Date.now()) {
  let params;
  try {
    params = new URL(href).searchParams;
  } catch {
    return getReferral(storage, now);
  }
  const pick = (k) => { const v = (params.get(k) || '').trim(); return CLEAN.test(v) ? v : null; };
  const discount = pick('code');
  const ref = pick('aff') || pick('ref') || discount;
  const existing = getReferral(storage, now);
  if (existing || !ref) return existing;
  const rec = { ref, discount, at: now };
  try { storage.setItem(REF_KEY, JSON.stringify(rec)); } catch {}
  return rec;
}
