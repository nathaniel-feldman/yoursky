// Network calls that don't need the Supabase client: anonymous funnel events and Edge Function calls.
// Keeping these on plain fetch means the quiz never loads the auth library or talks to auth.
import { SUPABASE_URL, SUPABASE_KEY, MOCK } from './env.js';

const EVENTS = new Set(['quiz_started', 'quiz_completed', 'save_prompt_shown', 'save_prompt_clicked', 'signed_up', 'unlock_clicked', 'friend_link_opened', 'share_clicked']);

/** Fire-and-forget funnel event. No ids or personal data, ever. */
export function track(name, props = {}) {
  if (!EVENTS.has(name)) return;
  if (MOCK) { (window.__events ||= []).push(name); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    fetch(`${SUPABASE_URL}/rest/v1/events`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ name, props }),
    }).catch(() => {});
  } catch {}
}

/** POST to an Edge Function. Pass the student's access token when signed in. */
export async function callFunction(name, body, accessToken) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken || SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
