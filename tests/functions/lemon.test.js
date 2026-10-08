// Lemon Squeezy webhook: signatures, parsing, and the full path into the database.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature, parseOrderEvent, makeWebhookHandler, redact } from '../../supabase/functions/_shared/lemon.js';
import { freshDb } from '../db/harness.js';

const SECRET = 'whsec_test_123';
const sign = (body, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');
const USER = '6f1c2d3e-4b5a-4c6d-8e7f-901234567890';

const orderEvent = ({ event = 'order_created', id = 1001, status = 'paid', user = USER, variant = 42, discount = 'CREATOR10' } = {}) => ({
  meta: { event_name: event, test_mode: true, custom_data: { user_id: user, discount_code: discount } },
  data: {
    type: 'orders',
    id: String(id),
    attributes: {
      status, total: 499, currency: 'USD', test_mode: true, affiliate_id: 7,
      user_name: 'Pat Doe', user_email: 'pat@example.com', urls: { receipt: 'https://example.com/r' },
      first_order_item: { variant_id: variant, product_name: 'Your Sky Pro' },
    },
  },
});
const request = (payload, { secret = SECRET, signature, method = 'POST' } = {}) => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Request('https://x.test/lemon-webhook', { method, body: method === 'POST' ? body : undefined, headers: { 'X-Signature': signature ?? sign(body, secret) } });
};
const quiet = { error: vi.fn(), info: vi.fn() };

describe('verifySignature', () => {
  it('accepts the hex HMAC-SHA256 of the raw body and rejects anything else', async () => {
    const body = '{"a":1}';
    expect(await verifySignature(body, sign(body), SECRET)).toBe(true);
    expect(await verifySignature(body, sign(body).toUpperCase(), SECRET)).toBe(true);
    expect(await verifySignature(body + ' ', sign(body), SECRET)).toBe(false);
    expect(await verifySignature(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(await verifySignature(body, null, SECRET)).toBe(false);
    expect(await verifySignature(body, 'abc', SECRET)).toBe(false);
    expect(await verifySignature(body, sign(body), '')).toBe(false);
  });
});

describe('parseOrderEvent', () => {
  it('extracts the order, the user from custom data, attribution, and drops personal data', () => {
    const ev = parseOrderEvent(orderEvent());
    expect(ev).toMatchObject({ event: 'order_created', orderId: '1001', userId: USER, status: 'paid', amount: 499, testMode: true, discountCode: 'CREATOR10', affiliateId: '7', variantId: '42' });
    expect(JSON.stringify(ev.raw)).not.toMatch(/pat@example.com|Pat Doe|receipt/);
  });
  it('ignores events it does not handle and rejects malformed orders', () => {
    expect(parseOrderEvent({ meta: { event_name: 'subscription_created' } })).toEqual({ ignored: true, event: 'subscription_created' });
    expect(() => parseOrderEvent({ meta: { event_name: 'order_created' }, data: { type: 'orders', id: 1, attributes: {} } })).toThrow(/status/);
    expect(() => parseOrderEvent({ meta: { event_name: 'order_created' } })).toThrow(/malformed/);
  });
  it('drops a user id or discount code that is not well formed', () => {
    const ev = parseOrderEvent(orderEvent({ user: "1 or 1=1", discount: 'a b;c' }));
    expect(ev.userId).toBeNull();
    expect(ev.discountCode).toBeNull();
  });
  it('redact leaves the original untouched', () => {
    const p = orderEvent();
    redact(p);
    expect(p.data.attributes.user_email).toBe('pat@example.com');
  });
});

describe('webhook handler with the real database', () => {
  let db, user, handler, events;
  beforeEach(async () => {
    db = await freshDb();
    user = await db.createUser('buyer@test.dev', { confirmed_13_plus: true, referral_code: 'tiktok_creator' });
    events = [];
    const applyOrder = (ev) => db.service((q) => q('select public.apply_lemon_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r',
      [ev.event, ev.orderId, ev.userId, ev.status, ev.amount, ev.currency, ev.testMode, ev.discountCode, ev.affiliateId, ev.raw])).then((r) => r.rows[0].r);
    handler = makeWebhookHandler({ secret: SECRET, variantId: '42', applyOrder, logEvent: async (n, p) => events.push([n, p]), log: quiet });
  });
  const isPro = async () => (await db.admin('select is_pro from public.profiles where id = $1', [user])).rows[0].is_pro;

  it('a test purchase flips is_pro, with the referral and discount on the order', async () => {
    const res = await handler(request(orderEvent({ user })));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, inserted: true, is_pro: true });
    expect(await isPro()).toBe(true);
    const o = (await db.admin('select * from public.orders')).rows[0];
    expect(o).toMatchObject({ referral_code: 'tiktok_creator', discount_code: 'CREATOR10', affiliate_id: '7', test_mode: true });
    expect(JSON.stringify(o.raw_event)).not.toMatch(/pat@example.com/);
    expect(events).toEqual([['purchase_completed', { test: true }]]);
  });

  it('duplicate deliveries do not double-insert or double-count', async () => {
    for (let i = 0; i < 3; i++) expect((await handler(request(orderEvent({ user })))).status).toBe(200);
    expect((await db.admin('select count(*)::int as n from public.orders')).rows[0].n).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('a refund flips is_pro back', async () => {
    await handler(request(orderEvent({ user })));
    await handler(request(orderEvent({ user, event: 'order_refunded', status: 'refunded' })));
    expect(await isPro()).toBe(false);
  });

  it('an invalid signature is rejected and nothing is stored', async () => {
    const res = await handler(request(orderEvent({ user }), { secret: 'wrong-secret' }));
    expect(res.status).toBe(401);
    expect((await handler(request(orderEvent({ user }), { signature: '' }))).status).toBe(401);
    expect((await db.admin('select count(*)::int as n from public.orders')).rows[0].n).toBe(0);
    expect(await isPro()).toBe(false);
  });

  it('ignores other products and other events, and rejects other methods', async () => {
    expect(await (await handler(request(orderEvent({ user, variant: 99 })))).json()).toMatchObject({ ignored: 'other product' });
    expect(await (await handler(request({ meta: { event_name: 'customer_updated' } }))).json()).toMatchObject({ ignored: 'customer_updated' });
    expect((await handler(request('', { method: 'GET' }))).status).toBe(405);
    expect(await isPro()).toBe(false);
  });

  it('returns 500 when storage fails so Lemon Squeezy retries', async () => {
    const failing = makeWebhookHandler({ secret: SECRET, applyOrder: async () => { throw new Error('db down'); }, log: quiet });
    expect((await failing(request(orderEvent({ user })))).status).toBe(500);
  });

  it('returns 400 for a signed but malformed body', async () => {
    expect((await handler(request('not json'))).status).toBe(400);
  });
});
