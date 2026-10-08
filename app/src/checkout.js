// Lemon Squeezy checkout: builds the overlay URL and loads Lemon.js on demand.
const LEMON_JS = 'https://app.lemonsqueezy.com/js/lemon.js';
const AFFILIATE_JS = 'https://lmsqueezy.com/affiliate.js';

/**
 * Checkout link carrying the Supabase user id (matched by the webhook), a prefilled email, and the creator code both
 * as a pre-applied discount and as custom data for our own attribution records.
 */
export function buildCheckoutUrl(base, { userId, email, discount, ref } = {}) {
  const u = new URL(base);
  u.searchParams.set('embed', '1');
  if (userId) u.searchParams.set('checkout[custom][user_id]', userId);
  if (email) u.searchParams.set('checkout[email]', email);
  if (discount) {
    u.searchParams.set('checkout[discount_code]', discount);
    u.searchParams.set('checkout[custom][discount_code]', discount);
  }
  if (ref) u.searchParams.set('checkout[custom][referral]', ref);
  return u.toString();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const found = document.querySelector(`script[src="${src}"]`);
    if (found) return found.dataset.loaded ? resolve() : found.addEventListener('load', () => resolve(), { once: true });
    const s = document.createElement('script');
    s.src = src; s.defer = true;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error('Could not load checkout. Check your connection and try again.'));
    document.head.appendChild(s);
  });
}

// Affiliate tracking (3.5 kB), so creator links pointing at findyoursky.com are credited.
export function loadAffiliateTracking(store) {
  if (!store || window.lemonSqueezyAffiliateConfig) return;
  window.lemonSqueezyAffiliateConfig = { store };
  loadScript(AFFILIATE_JS).catch(() => {});
}

/** Opens the checkout overlay; resolves 'success' on Checkout.Success. */
export async function openCheckout(url, onEvent = () => {}) {
  await loadScript(LEMON_JS);
  if (typeof window.createLemonSqueezy === 'function') window.createLemonSqueezy();
  const LS = window.LemonSqueezy;
  if (!LS?.Url?.Open) throw new Error('Checkout is unavailable right now. Please try again.');
  LS.Setup({ eventHandler: (e) => onEvent(e?.event, e) });
  const tracked = LS.Affiliate?.Build ? LS.Affiliate.Build(url) : url;
  LS.Url.Open(tracked);
}
