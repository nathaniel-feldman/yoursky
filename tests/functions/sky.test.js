// Server-side sky: what free, signed-in and Pro callers get back, user verification, and the shared engine copy.
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { computeSky, cleanInput, makeSkyHandler, makeDeleteHandler, detailFor, HIDDEN_COUNT } from '../../supabase/functions/_shared/sky.js';
import { makeUserResolver } from '../../supabase/functions/_shared/auth.js';
import { corsFor, withCors } from '../../supabase/functions/_shared/http.js';
import data from '../../app/src/data.json';

// Treat the first 150 schools as curated and the rest as the hidden pool for these tests.
const curated = data.schools.slice(0, 150);
const pool = data.schools.slice(150);
const body = {
  profile: { gpa: 3.7, testMode: 'sat', sat: 1380, major: 'cs', region: 'ne', state: 'MA' },
  answers: { setting: 'city', size: 60, distance: 40, social: ['arts'], activities: ['hackathons'] },
  income: 1,
};
const input = cleanInput(body);

describe('computeSky', () => {
  it('free and anonymous: only a count and fits for hidden matches, nothing identifying', () => {
    const r = computeSky({ curated, pool, input, isPro: false, signedIn: false });
    expect(r).toEqual({ pro: false, hidden: { count: HIDDEN_COUNT, fits: expect.any(Array) }, reveal: null });
    const text = JSON.stringify(r);
    for (const s of pool) expect(text).not.toContain(s.f);
    expect(text).not.toMatch(/"chance"|"cost"|"earnings"|"id"/);
  });

  it('free and signed in: one reveal, for their #1 curated school only', () => {
    const r = computeSky({ curated, pool, input, isPro: false, signedIn: true });
    const best = curated.map((s) => s.id).find((id) => id === r.reveal.id);
    expect(best).toBeDefined();
    expect(Object.keys(r)).toEqual(['pro', 'hidden', 'reveal']);
    expect(r.reveal).toMatchObject({ chance: { category: expect.any(String) }, cost: { net: expect.any(Number), basis: 'income' } });
    for (const s of pool) expect(JSON.stringify(r)).not.toContain(s.f);
  });

  it('Pro: hidden schools in full plus details for the top schools and requested ids', () => {
    const asked = curated[120].id;
    const r = computeSky({ curated, pool, input: { ...input, ids: [asked, pool[0].id] }, isPro: true, signedIn: true });
    expect(r.hidden).toHaveLength(HIDDEN_COUNT);
    expect(r.hidden.every((h) => pool.some((s) => s.id === h.school.id))).toBe(true);
    expect(r.details[asked]).toBeDefined();
    expect(r.details[pool[0].id]).toBeUndefined(); // ids outside the curated set are ignored
    expect(Object.keys(r.details).length).toBeGreaterThanOrEqual(40);
    expect(r.ranked[0].fit).toBeGreaterThanOrEqual(r.ranked[1].fit);
  });

  it('never reports a negative cost', () => {
    const neg = { ...curated[0], nbi: [-2500, 5000, 9000, 12000, 20000] };
    const d = detailFor(neg, input.profile, 0);
    expect(d.cost.net).toBe(0);
    expect(d.cost.grantsExceedCost).toBe(true);
  });

  it('labels the cost basis', () => {
    const s = { ...curated[0], nbi: [1, 2, 3, 4, 5] };
    expect(detailFor(s, input.profile, 2).cost.basis).toBe('income');
    expect(detailFor(s, input.profile, null).cost.basis).toBe(s.net != null ? 'average' : 'estimate');
    expect(detailFor(s, { ...input.profile, region: 'intl' }, 2).cost.basis).toBe('international');
  });
});

describe('cleanInput', () => {
  it('keeps valid quiz shapes and drops everything else', () => {
    const c = cleanInput({
      profile: { gpa: 9, sat: 1500, testMode: 'sat', major: 'cs', state: 'XX', region: 'ne', email: 'x@y.z', name: 'Sam' },
      answers: { size: 50, setting: 'city', weather: 'lava', activities: ['hackathons', 'hackathons', 'nope', 'ski', 'music', 'art', 'film', 'debate'], evil: 1 },
      income: 7, ids: [1, 'x', 2.5, 3],
    });
    expect(c.profile).toMatchObject({ gpa: null, sat: 1500, major: 'cs', state: null, region: 'ne', name: '' });
    expect(c.profile.email).toBeUndefined();
    expect(c.answers).toEqual({ size: 50, setting: 'city', activities: ['hackathons', 'ski', 'music', 'art', 'film'] });
    expect(c.income).toBeNull();
    expect(c.ids).toEqual([1, 3]);
  });
  it('survives garbage', () => {
    expect(() => cleanInput(null)).not.toThrow();
    expect(cleanInput('x').profile.testMode).toBe('none');
  });
});

describe('user verification', () => {
  let jwks, privateKey;
  const url = 'https://abc.supabase.co';
  beforeAll(async () => {
    const kp = await generateKeyPair('ES256');
    privateKey = kp.privateKey;
    jwks = { keys: [{ ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'ES256' }] };
  });
  const token = (claims = {}, opts = {}) =>
    new SignJWT({ role: 'authenticated', email: 'a@b.c', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setSubject(opts.sub ?? 'user-1').setIssuer(opts.iss ?? `${url}/auth/v1`).setAudience(opts.aud ?? 'authenticated')
      .setExpirationTime(opts.exp ?? '1h').sign(privateKey);
  const req = (t) => new Request('https://x.test', { headers: t ? { Authorization: `Bearer ${t}` } : {} });

  it('accepts a valid Supabase access token and rejects wrong issuer, audience, expired or anonymous', async () => {
    const resolve = makeUserResolver({ supabaseUrl: url, jwks });
    expect(await resolve(req(await token()))).toEqual({ id: 'user-1', email: 'a@b.c' });
    expect(await resolve(req(await token({}, { iss: 'https://evil.supabase.co/auth/v1' })))).toBeNull();
    expect(await resolve(req(await token({}, { aud: 'anon' })))).toBeNull();
    expect(await resolve(req(await token({}, { exp: Math.floor(Date.now() / 1000) - 60 })))).toBeNull();
    expect(await resolve(req('sb_publishable_abc'))).toBeNull();
    expect(await resolve(req())).toBeNull();
  });

  it('falls back to Supabase Auth when the project has no public signing keys', async () => {
    const calls = [];
    const fetchImpl = async (u, init) => { calls.push([u, init.headers.apikey]); return new Response(JSON.stringify({ id: 'u9', email: 'z@z.z' })); };
    const resolve = makeUserResolver({ supabaseUrl: url, jwks: null, publishableKey: 'sb_publishable_x', fetchImpl });
    expect(await resolve(req('a.b.c'))).toEqual({ id: 'u9', email: 'z@z.z' });
    expect(calls).toEqual([[`${url}/auth/v1/user`, 'sb_publishable_x']]);
  });

  it('the sky handler gates on the server-side Pro flag, not anything the client sends', async () => {
    const resolve = makeUserResolver({ supabaseUrl: url, jwks });
    const handler = makeSkyHandler({ resolveUser: resolve, isProUser: async (id) => id === 'pro-user', loadSchools: async () => ({ curated, pool }) });
    const post = async (t, extra = {}) => (await handler(new Request('https://x.test', { method: 'POST', body: JSON.stringify({ ...body, ...extra }), headers: t ? { Authorization: `Bearer ${t}` } : {} }))).json();
    expect((await post(null, { pro: true, is_pro: true })).pro).toBe(false);
    expect((await post(await token())).reveal).not.toBeNull();
    expect((await post(await token({}, { sub: 'pro-user' }))).pro).toBe(true);
  });

  it('account deletion requires a signed-in caller and deletes only them', async () => {
    const deleted = [];
    const h = makeDeleteHandler({ resolveUser: makeUserResolver({ supabaseUrl: url, jwks }), deleteUser: async (id) => deleted.push(id) });
    expect((await h(new Request('https://x.test', { method: 'POST' }))).status).toBe(401);
    expect((await h(new Request('https://x.test', { method: 'POST', headers: { Authorization: `Bearer ${await token({}, { sub: 'me' })}` } }))).status).toBe(200);
    expect(deleted).toEqual(['me']);
  });
});

describe('CORS', () => {
  const wrapped = withCors(corsFor('https://staging.example.com'), async () => new Response('ok'));
  const origin = async (o, method = 'POST') => (await wrapped(new Request('https://x.test', { method, headers: { Origin: o } }))).headers.get('Access-Control-Allow-Origin');
  it('allows the site, previews, localhost and configured origins only', async () => {
    expect(await origin('https://findyoursky.com')).toBe('https://findyoursky.com');
    expect(await origin('https://feature-x.yoursky.pages.dev')).toBe('https://feature-x.yoursky.pages.dev');
    expect(await origin('http://localhost:5173', 'OPTIONS')).toBe('http://localhost:5173');
    expect(await origin('https://staging.example.com')).toBe('https://staging.example.com');
    expect(await origin('https://yoursky.nfeldman2000.workers.dev')).toBe('https://yoursky.nfeldman2000.workers.dev');
    expect(await origin('https://feature-accounts-and-pro-yoursky.nfeldman2000.workers.dev')).toBe('https://feature-accounts-and-pro-yoursky.nfeldman2000.workers.dev');
    expect(await origin('https://evil.workers.dev')).toBe('https://findyoursky.com');
    expect(await origin('https://evilyoursky.attacker.workers.dev')).toBe('https://findyoursky.com');
    expect(await origin('https://yoursky.attacker.workers.dev')).toBe('https://findyoursky.com');
    expect(await origin('https://phish-other.someone.workers.dev')).toBe('https://findyoursky.com');
    expect(await origin('https://evil.com')).toBe('https://findyoursky.com');
  });
});

describe('shared engine copy', () => {
  it('matches the app exactly (run npm run sync:shared after editing the engine)', () => {
    for (const f of ['engine.js', 'config.js']) {
      expect(readFileSync(`supabase/functions/_shared/app/${f}`, 'utf8'), f).toBe(readFileSync(`app/src/${f}`, 'utf8'));
    }
  });
});
