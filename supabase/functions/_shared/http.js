// Small HTTP helpers shared by the Edge Functions.

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const DEFAULT_ORIGINS = ['https://findyoursky.com', 'https://www.findyoursky.com'];
const PATTERNS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/, /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev$/];

// CORS for browser calls. ALLOWED_ORIGINS (comma-separated) adds exact origins; Pages preview and localhost are allowed.
export function corsFor(extra = '') {
  const exact = new Set([...DEFAULT_ORIGINS, ...extra.split(',').map((s) => s.trim()).filter(Boolean)]);
  return (req) => {
    const origin = req.headers.get('Origin') ?? '';
    const ok = exact.has(origin) || PATTERNS.some((p) => p.test(origin));
    return {
      'Access-Control-Allow-Origin': ok ? origin : DEFAULT_ORIGINS[0],
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
  };
}

// Wraps a handler with CORS preflight and headers, and a body size limit.
export function withCors(cors, handler, { maxBytes = 32_000 } = {}) {
  return async (req) => {
    const headers = cors(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (Number(req.headers.get('Content-Length') ?? 0) > maxBytes) return json({ error: 'request too large' }, 413, headers);
    let res;
    try {
      res = await handler(req);
    } catch (e) {
      console.error(e);
      res = json({ error: 'server error' }, 500);
    }
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };
}

export async function readJson(req, maxBytes = 32_000) {
  const text = await req.text();
  if (text.length > maxBytes) throw Object.assign(new Error('request too large'), { status: 413 });
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('invalid JSON'), { status: 400 });
  }
}
