// The account backend, loaded only when it's first needed (signing in, saving, a returning session, Pro data), so the
// anonymous quiz never downloads the auth library. Both implementations share one interface:
//   user() → { id, email } | null          onAuth(cb)           ready()  (finishes any sign-in redirect)
//   sendCode(email, meta)   verifyCode(email, code)   signInWithGoogle()   signOut()
//   profile()   updateProfile(patch)   confirm13()   claimReferral(code)
//   saveSky(rec) → id   listSkies()   deleteSky(id)   deleteAccount()
//   skyData(body)   requestFriend(code)   listFriends()   respondFriend(id, accept)   unfriend(id)   friendSky(friendId)
import { MOCK, SUPABASE_URL, SUPABASE_KEY, accountsOn } from './env.js';

let pending = null;

export function getBackend() {
  if (!accountsOn) return Promise.resolve(null);
  if (!pending) {
    // Inlined (not the MOCK import) so production builds can drop the mock entirely.
    pending = (import.meta.env.DEV && import.meta.env.VITE_MOCK_BACKEND === '1' ? import('./backend-mock.js') : import('./backend-supabase.js'))
      .then((m) => m.createBackend({ url: SUPABASE_URL, key: SUPABASE_KEY }))
      .catch((e) => { pending = null; throw e; });
  }
  return pending;
}

// Whether this browser probably has a session or is returning from a sign-in link, so the backend should load at start.
export function shouldLoadAtStart() {
  if (!accountsOn) return false;
  // ?code= is also a creator code (see referral.js); it's a sign-in return only when a PKCE verifier is waiting.
  if (/[?&#](token_hash|access_token|error_description)=/.test(location.search + location.hash)) return true;
  try {
    if (MOCK) return !!localStorage.getItem('yoursky.mock.session');
    const keys = Object.keys(localStorage);
    if (/[?&]code=/.test(location.search) && keys.some((k) => /^sb-.*-code-verifier$/.test(k))) return true;
    return keys.some((k) => /^sb-.*-auth-token$/.test(k));
  } catch {
    return false;
  }
}
