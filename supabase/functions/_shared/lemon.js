// Lemon Squeezy webhooks: signature verification and order-event parsing.
// Docs: X-Signature is the hex HMAC-SHA256 of the raw request body, keyed with the webhook signing secret.
// Custom checkout data (checkout[custom][...]) arrives in meta.custom_data.
import { json } from './http.js';

const enc = new TextEncoder();

export async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time comparison so response timing doesn't leak how much of a forged signature matched.
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature.trim())) return false;
  return sameString(await hmacHex(secret, rawBody), signature.trim().toLowerCase());
}

const ORDER_EVENTS = new Set(['order_created', 'order_refunded']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_-]{1,64}$/;

// The buyer's name, email and receipt links are never stored.
export function redact(payload) {
  const copy = structuredClone(payload);
  const a = copy?.data?.attributes;
  if (a) for (const k of ['user_name', 'user_email', 'urls']) delete a[k];
  return copy;
}

// Returns { ignored: true } for events we don't handle, or the fields apply_lemon_order() needs.
export function parseOrderEvent(payload) {
  const event = payload?.meta?.event_name;
  if (!ORDER_EVENTS.has(event)) return { ignored: true, event: event ?? null };
  const data = payload.data;
  if (!data || data.type !== 'orders' || data.id == null) throw new Error('malformed order event');
  const a = data.attributes ?? {};
  if (typeof a.status !== 'string') throw new Error('order has no status');
  const custom = payload.meta.custom_data ?? {};
  return {
    ignored: false,
    event,
    orderId: String(data.id),
    userId: typeof custom.user_id === 'string' && UUID.test(custom.user_id) ? custom.user_id : null,
    status: a.status,
    amount: Number.isInteger(a.total) ? a.total : null,
    currency: typeof a.currency === 'string' ? a.currency : null,
    testMode: a.test_mode === true,
    discountCode: typeof custom.discount_code === 'string' && CODE.test(custom.discount_code) ? custom.discount_code : null,
    affiliateId: a.affiliate_id != null ? String(a.affiliate_id) : null,
    variantId: a.first_order_item?.variant_id != null ? String(a.first_order_item.variant_id) : null,
    raw: redact(payload),
  };
}

/**
 * @typedef {{ ignored: false, event: string, orderId: string, userId: string|null, status: string, amount: number|null,
 *   currency: string|null, testMode: boolean, discountCode: string|null, affiliateId: string|null, variantId: string|null,
 *   raw: object }} OrderEvent
 */

/**
 * The webhook endpoint. Returns 2xx only once the order is safely stored, so Lemon Squeezy retries on any failure.
 * @param {{ secret: string, variantId?: string, applyOrder: (ev: OrderEvent) => Promise<any>, logEvent?: (name: string, props: Record<string, unknown>) => Promise<unknown>, log?: Pick<Console, 'error' | 'info'> }} deps
 */
export function makeWebhookHandler({ secret, variantId, applyOrder, logEvent = async () => {}, log = console }) {
  return async (req) => {
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const raw = await req.text();
    if (!(await verifySignature(raw, req.headers.get('X-Signature'), secret))) {
      log.error('lemon-webhook: rejected a request with a missing or invalid signature');
      return json({ error: 'invalid signature' }, 401);
    }
    let ev;
    try {
      ev = parseOrderEvent(JSON.parse(raw));
    } catch (e) {
      log.error('lemon-webhook: could not parse event', e);
      return json({ error: 'malformed event' }, 400);
    }
    if (ev.ignored) return json({ ok: true, ignored: ev.event });
    // The store may sell other things; only the Pro product grants Pro.
    if (variantId && ev.variantId !== String(variantId)) return json({ ok: true, ignored: 'other product' });
    if (!ev.userId) log.error(`lemon-webhook: order ${ev.orderId} has no valid user_id in custom data; storing it unlinked`);
    try {
      const result = await applyOrder(ev);
      if (result?.inserted && ev.event === 'order_created' && ev.status === 'paid') {
        await logEvent('purchase_completed', { test: ev.testMode }).catch((e) => log.error('lemon-webhook: event log failed', e));
      }
      log.info(`lemon-webhook: ${ev.event} ${ev.orderId} ${ev.status} → ${JSON.stringify(result)}`);
      return json({ ok: true, ...result });
    } catch (e) {
      log.error(`lemon-webhook: storing order ${ev.orderId} failed`, e);
      return json({ error: 'storage failed' }, 500);
    }
  };
}
