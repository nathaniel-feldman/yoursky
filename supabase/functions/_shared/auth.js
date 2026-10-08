// Identifies the signed-in student calling an Edge Function, from the Authorization: Bearer <access token> header.
// Tokens are verified locally against the project's signing keys (SUPABASE_JWKS). Projects still on a shared JWT
// secret have no public keys, so those fall back to asking Supabase Auth to validate the token.
import { createLocalJWKSet, jwtVerify } from 'jose';

/**
 * @param {{ supabaseUrl: string, jwks?: { keys?: object[] } | null, publishableKey?: string, fetchImpl?: typeof fetch }} opts
 * @returns {(req: Request) => Promise<{ id: string, email?: string } | null>}
 */
export function makeUserResolver({ supabaseUrl, jwks, publishableKey = '', fetchImpl = fetch }) {
  const keyset = jwks?.keys?.length ? createLocalJWKSet(jwks) : null;
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  return async (req) => {
    const m = (req.headers.get('Authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
    if (!m || m[1].split('.').length !== 3) return null; // anonymous callers send the publishable key, which isn't a JWT
    const token = m[1];
    if (keyset) {
      try {
        const { payload } = await jwtVerify(token, keyset, { issuer, audience: 'authenticated' });
        return typeof payload.sub === 'string' ? { id: payload.sub, email: payload.email } : null;
      } catch {
        return null;
      }
    }
    const res = await fetchImpl(`${issuer}/user`, { headers: { Authorization: `Bearer ${token}`, apikey: publishableKey } });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? { id: user.id, email: user.email } : null;
  };
}
