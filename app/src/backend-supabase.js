// Supabase implementation of the backend interface (see backend.js).
import { createClient } from '@supabase/supabase-js';
import { callFunction } from './api.js';

const friendly = (error) => {
  const m = error?.message || String(error);
  if (/rate limit|security purposes|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/expired|invalid|otp/i.test(m)) return 'That code didn’t work. Check it or send a new one.';
  if (/fetch|network/i.test(m)) return 'Can’t reach the server. Check your connection.';
  return m;
};
const check = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };

export async function createBackend({ url, key }) {
  const sb = createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });

  // Email links use a token_hash (works in any browser, unlike a PKCE link); Google returns ?code= which
  // detectSessionInUrl exchanges. Either way, clean the URL afterwards.
  async function ready() {
    const q = new URLSearchParams(location.search);
    const tokenHash = q.get('token_hash');
    let err = q.get('error_description');
    if (tokenHash) {
      const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: q.get('type') || 'email' });
      if (error) err = friendly(error);
    }
    await sb.auth.getSession();
    // Strip sign-in parameters (a creator ?code= stays only if it wasn't a sign-in return; it's already captured).
    const authParams = ['token_hash', 'type', 'error', 'error_description', 'error_code'];
    if (tokenHash || q.has('error_description') || (q.has('code') && (await sb.auth.getSession()).data.session)) authParams.push('code');
    if (authParams.some((k) => q.has(k)) || /^#(access_token|error)/.test(location.hash)) {
      for (const k of authParams) q.delete(k);
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash.replace(/^#(access_token|error).*/, ''));
    }
    if (err) throw new Error(err);
  }

  let current = null;
  const set = (session) => (current = session?.user ? { id: session.user.id, email: session.user.email } : null);
  set((await sb.auth.getSession()).data.session);
  const token = async () => (await sb.auth.getSession()).data.session?.access_token;

  return {
    ready,
    user: () => current,
    onAuth(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => { const before = current?.id; set(session); if (before !== current?.id) cb(current); });
      return () => data.subscription.unsubscribe();
    },
    async sendCode(email, { confirmed13, referral } = {}) {
      check(await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo: location.origin + '/', data: { confirmed_13_plus: !!confirmed13, referral_code: referral || undefined } },
      }));
    },
    async verifyCode(email, code) {
      const data = check(await sb.auth.verifyOtp({ email, token: code.trim(), type: 'email' }));
      set(data.session);
      return current;
    },
    async signInWithGoogle() {
      check(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } }));
    },
    async signOut() {
      await sb.auth.signOut();
      current = null;
    },
    async profile() {
      return check(await sb.from('profiles').select('*').eq('id', current.id).single());
    },
    async updateProfile(patch) {
      check(await sb.from('profiles').update(patch).eq('id', current.id));
    },
    async confirm13() { check(await sb.rpc('confirm_13_plus')); },
    async claimReferral(code) { if (code) check(await sb.rpc('claim_referral', { code })); },
    async saveSky(rec) {
      return check(await sb.from('skies').insert(rec).select('id').single()).id;
    },
    async listSkies() {
      return check(await sb.from('skies').select('id, created_at, quiz_answers, profile_snapshot, results').eq('user_id', current.id).order('created_at', { ascending: false }).limit(20));
    },
    async deleteSky(id) { check(await sb.from('skies').delete().eq('id', id)); },
    async deleteAccount() {
      await callFunction('account-delete', {}, await token());
      await sb.auth.signOut({ scope: 'local' });
      current = null;
    },
    async skyData(body) { return callFunction('sky', body, await token()); },
    async requestFriend(code) { return check(await sb.rpc('request_friend', { code })); },
    async listFriends() { return check(await sb.rpc('list_friends')); },
    async respondFriend(id, accept) { return check(await sb.rpc('respond_friend', { friendship: id, accept })); },
    async unfriend(id) { check(await sb.from('friendships').delete().eq('id', id)); },
    async friendSky(friendId) { return (check(await sb.rpc('friend_sky', { friend: friendId })) || [])[0] || null; },
  };
}
