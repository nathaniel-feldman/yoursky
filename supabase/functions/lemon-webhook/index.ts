// Lemon Squeezy webhook: verifies the signature, then stores the order and updates Pro through apply_lemon_order().
// Configure in Lemon Squeezy → Settings → Webhooks with events order_created and order_refunded.
import { makeWebhookHandler } from '../_shared/lemon.js';
import { admin, logEvent } from '../_shared/supabase.ts';

const handler = makeWebhookHandler({
  secret: Deno.env.get('LEMON_WEBHOOK_SECRET') ?? '',
  variantId: Deno.env.get('LEMON_VARIANT_ID') || undefined,
  logEvent,
  applyOrder: async (ev) => {
    const { data, error } = await admin.rpc('apply_lemon_order', {
      p_event: ev.event,
      p_order_id: ev.orderId,
      p_user: ev.userId,
      p_status: ev.status,
      p_amount: ev.amount,
      p_currency: ev.currency,
      p_test_mode: ev.testMode,
      p_discount_code: ev.discountCode,
      p_affiliate_id: ev.affiliateId,
      p_raw: ev.raw,
    });
    if (error) throw error;
    return data;
  },
});

Deno.serve(handler);
