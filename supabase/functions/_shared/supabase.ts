// Clients and configuration for the deployed Edge Functions (Deno only; the shared logic stays runtime-neutral).
import { createClient } from '@supabase/supabase-js';
import { makeUserResolver } from './auth.js';

const env = (k: string) => Deno.env.get(k) ?? '';
const keys = (k: string): Record<string, string> => {
  try {
    return JSON.parse(env(k) || '{}');
  } catch {
    return {};
  }
};

export const SUPABASE_URL = env('SUPABASE_URL');
// New-style keys first (sb_secret_… / sb_publishable_…); legacy service_role/anon keys as a fallback.
const SECRET_KEY = keys('SUPABASE_SECRET_KEYS').default ?? env('SUPABASE_SERVICE_ROLE_KEY');
export const PUBLISHABLE_KEY = keys('SUPABASE_PUBLISHABLE_KEYS').default ?? env('SUPABASE_ANON_KEY');

export const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let jwks = null;
try {
  jwks = JSON.parse(env('SUPABASE_JWKS') || 'null');
} catch {
  jwks = null;
}
export const resolveUser = makeUserResolver({ supabaseUrl: SUPABASE_URL, jwks, publishableKey: PUBLISHABLE_KEY });

export async function logEvent(name: string, props: Record<string, unknown> = {}) {
  const { error } = await admin.from('events').insert({ name, props });
  if (error) throw error;
}
