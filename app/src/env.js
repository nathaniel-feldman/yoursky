// Build-time configuration (see .env.example). With nothing set, accounts and Pro stay off and the app behaves
// exactly like the account-free version. Values are read as import.meta.env.* so Vite substitutes them at build time.
export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
// Lemon Squeezy checkout link for the Pro product: https://STORE.lemonsqueezy.com/checkout/buy/VARIANT_UUID
export const LEMON_CHECKOUT_URL = import.meta.env.VITE_LEMON_CHECKOUT_URL || '';
// Store slug for the affiliate tracking script (Lemon Squeezy → Affiliates → settings).
export const LEMON_STORE = import.meta.env.VITE_LEMON_STORE || '';
export const PRO_PRICE = import.meta.env.VITE_PRO_PRICE || '$4.99';
// Must match Supabase → Authentication → Email → "Email OTP Length" (6 recommended). Codes of 6–10 digits are accepted
// either way; this length is what the form expects and auto-submits at.
export const OTP_LENGTH = Number(import.meta.env.VITE_OTP_LENGTH) || 6;
// Dev only: an in-browser fake backend for trying the account and Pro flows without Supabase.
export const MOCK = import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === '1';

export const accountsOn = MOCK || !!(SUPABASE_URL && SUPABASE_KEY);
export const proOn = accountsOn && (MOCK || !!LEMON_CHECKOUT_URL);
