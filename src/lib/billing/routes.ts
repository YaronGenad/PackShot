/**
 * PayPal billing routes — subscriptions, one-time orders, webhooks.
 * Handles subscription lifecycle: create, renew, cancel, upgrade/downgrade.
 * One-time payments: AI credit packs, watermark removal.
 */

import { Router, Request, Response } from 'express';
import { supabaseAdmin, updateUserTier, getProfile } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import { addPurchasedCredits } from '../credits/ai-credits.js';
import { grantReward } from '../rewards/rewards.js';
import { sendSubscriptionConfirmedEmail, sendSubscriptionCancelledEmail, sendCreditsPurchasedEmail } from '../email/notifications.js';
import {
  createSubscription,
  getSubscription,
  cancelSubscription as paypalCancelSubscription,
  createOrder,
  captureOrder,
  verifyWebhookSignature,
} from './paypal.js';
import { createReceipt } from '../invoicing/icount.js';

const router = Router();

/** Map tier + interval to PayPal Plan IDs from env. */
function getPlanId(tier: 'pro' | 'studio', interval: 'month' | 'year'): string | undefined {
  const map: Record<string, string | undefined> = {
    'pro:month': process.env.PAYPAL_PLAN_PRO_MONTHLY,
    'pro:year': process.env.PAYPAL_PLAN_PRO_YEARLY,
    'studio:month': process.env.PAYPAL_PLAN_STUDIO_MONTHLY,
    'studio:year': process.env.PAYPAL_PLAN_STUDIO_YEARLY,
  };
  return map[`${tier}:${interval}`];
}

/** Determine tier from a PayPal Plan ID. */
function tierFromPlanId(planId: string): 'pro' | 'studio' | null {
  const proPlanIds = [
    process.env.PAYPAL_PLAN_PRO_MONTHLY,
    process.env.PAYPAL_PLAN_PRO_YEARLY,
  ].filter(Boolean);
  const studioPlanIds = [
    process.env.PAYPAL_PLAN_STUDIO_MONTHLY,
    process.env.PAYPAL_PLAN_STUDIO_YEARLY,
  ].filter(Boolean);

  if (proPlanIds.includes(planId)) return 'pro';
  if (studioPlanIds.includes(planId)) return 'studio';
  return null;
}

/** Credit pack pricing. */
const CREDIT_PACK_PRICES: Record<string, { credits: number; price: string }> = {
  '50':  { credits: 50,  price: '5.00' },
  '120': { credits: 120, price: '10.00' },
  '300': { credits: 300, price: '20.00' },
};

/**
 * POST /api/billing/create-checkout — Create PayPal subscription.
 */
router.post('/create-checkout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tier, interval = 'month' } = req.body;
    const user = req.user!;

    if (!['pro', 'studio'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "studio".' });
    }

    const planId = getPlanId(tier, interval);
    if (!planId) {
      return res.status(500).json({ error: `Plan not configured for ${tier}/${interval}` });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const { approvalUrl } = await createSubscription(
      planId,
      `${appUrl}/?checkout=success`,
      `${appUrl}/?checkout=cancelled`,
      user.id,
    );

    res.json({ url: approvalUrl });
  } catch (err: any) {
    console.error('create-checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

/**
 * POST /api/billing/buy-credits — Purchase AI credit pack via PayPal order.
 * Body: { pack: '50' | '120' | '300' }
 */
router.post('/buy-credits', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pack } = req.body;
    const user = req.user!;

    if (user.tier === 'free') {
      return res.status(403).json({
        error: 'AI credits require a Pro or Studio subscription',
        upgrade: 'pro',
      });
    }

    const packInfo = CREDIT_PACK_PRICES[pack];
    if (!packInfo) {
      return res.status(400).json({ error: 'Invalid credit pack. Choose 50, 120, or 300.' });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const { approvalUrl } = await createOrder(
      packInfo.price,
      'USD',
      `PackShot AI Credits (${packInfo.credits})`,
      `${user.id}:credit:${pack}`,
      `${appUrl}/?checkout=success`,
      `${appUrl}/?checkout=cancelled`,
    );

    res.json({ url: approvalUrl });
  } catch (err: any) {
    console.error('buy-credits error:', err);
    res.status(500).json({ error: 'Failed to create credit checkout', details: err.message });
  }
});

/**
 * POST /api/billing/remove-watermark — One-time payment to remove watermark.
 */
router.post('/remove-watermark', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    // Launch promo: $1 instead of $2
    const launchPromo = process.env.WATERMARK_LAUNCH_PROMO !== 'false';
    const amount = launchPromo ? '1.00' : '2.00';

    const { approvalUrl } = await createOrder(
      amount,
      'USD',
      'Watermark Removal (one-time)',
      `${user.id}:watermark`,
      `${appUrl}/api/billing/popup-return?type=watermark`,
      `${appUrl}/?watermark=cancelled`,
    );

    res.json({ url: approvalUrl });
  } catch (err: any) {
    console.error('remove-watermark error:', err);
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

/**
 * GET /api/billing/popup-return — PayPal redirects the popup here after payment.
 * Captures the order server-side, then renders HTML that closes the popup window.
 */
router.get('/popup-return', async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const type = req.query.type as string;
  let message = 'Payment processed!';

  if (token) {
    try {
      const capture = await captureOrder(token);
      const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
        || capture.purchase_units?.[0]?.custom_id;
      if (customId) await processOneTimePayment(customId);
      message = type === 'watermark'
        ? 'Watermark credit added! You can close this window and download your image.'
        : 'Payment successful!';
    } catch (err: any) {
      message = 'Payment was received. You can close this window.';
    }
  }

  res.send(`<!DOCTYPE html>
<html><head><title>PackShot Payment</title>
<style>body{font-family:system-ui;background:#0a0b0d;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:40px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);max-width:400px}
.check{font-size:48px;margin-bottom:16px}
.msg{font-size:16px;margin-bottom:24px;color:#ccc}
.close{background:#f97316;color:#fff;border:none;padding:12px 32px;border-radius:12px;font-size:14px;font-weight:bold;cursor:pointer;text-transform:uppercase;letter-spacing:2px}
.close:hover{background:#ea580c}
.auto{font-size:11px;color:#666;margin-top:16px}</style></head>
<body><div class="box">
<div class="check">✓</div>
<div class="msg">${message}</div>
<button class="close" onclick="window.close()">Close Window</button>
<div class="auto">This window will close automatically...</div>
</div>
<script>setTimeout(()=>window.close(),3000)</script>
</body></html>`);
});

/**
 * POST /api/billing/capture-order — Capture an approved PayPal order (called after redirect back).
 * Body: { orderId: string }
 */
router.post('/capture-order', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const capture = await captureOrder(orderId);
    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
      || capture.purchase_units?.[0]?.custom_id;

    if (customId) {
      await processOneTimePayment(customId);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('capture-order error:', err);
    res.status(500).json({ error: 'Failed to capture order', details: err.message });
  }
});

/**
 * POST /api/billing/webhook — PayPal webhook handler.
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    // Verify webhook signature (skip in development if no webhook ID)
    if (webhookId) {
      const headers: Record<string, string> = {};
      for (const key of ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time']) {
        headers[key] = req.headers[key] as string || '';
      }

      const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const valid = await verifyWebhookSignature(headers, rawBody, webhookId);
      if (!valid) {
        console.error('PayPal webhook signature verification failed');
        return res.status(400).json({ error: 'Invalid webhook signature' });
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event_type;

    console.log(`PayPal webhook: ${eventType}`, event.id);

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        await handleSubscriptionActivated(event.resource);
        break;

      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handleSubscriptionCancelled(event.resource);
        break;

      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        await handleSubscriptionSuspended(event.resource);
        break;

      case 'BILLING.SUBSCRIPTION.UPDATED':
        await handleSubscriptionUpdated(event.resource);
        break;

      case 'PAYMENT.SALE.COMPLETED':
        await handlePaymentCompleted(event.resource);
        break;

      case 'CHECKOUT.ORDER.APPROVED':
        await handleOrderApproved(event.resource);
        break;
    }

    res.json({ received: true });
  } catch (err: any) {
    console.error('Webhook processing failed:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * GET /api/billing/portal — Redirect to PayPal subscription management.
 */
router.get('/portal', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  // PayPal doesn't have a hosted portal like Stripe.
  // Redirect to PayPal auto-pay management page.
  res.json({ url: 'https://www.paypal.com/myaccount/autopay' });
});

/**
 * POST /api/billing/cancel — Cancel current subscription.
 */
router.post('/cancel', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const { reason = 'User requested cancellation' } = req.body;

    // Find active PayPal subscription
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['active', 'past_due'])
      .not('paypal_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!sub?.paypal_subscription_id) {
      return res.status(400).json({ error: 'No active subscription found' });
    }

    await paypalCancelSubscription(sub.paypal_subscription_id, reason);

    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', cancel_at_period_end: true })
      .eq('paypal_subscription_id', sub.paypal_subscription_id);

    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (err: any) {
    console.error('cancel error:', err);
    res.status(500).json({ error: 'Failed to cancel subscription', details: err.message });
  }
});

/**
 * GET /api/billing/status — Get current billing status.
 */
router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const { data: subscription } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['active', 'past_due'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    res.json({
      tier: user.tier,
      subscription: subscription ? {
        tier: subscription.tier,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
      } : null,
      has_paypal: !!user.paypal_payer_id,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch billing status' });
  }
});

/**
 * POST /api/billing/sync — Manual subscription sync from PayPal.
 */
router.post('/sync', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    // Find latest subscription record
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .not('paypal_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!sub?.paypal_subscription_id) {
      return res.json({ synced: false, message: 'No PayPal subscription found' });
    }

    // Fetch current state from PayPal
    const ppSub = await getSubscription(sub.paypal_subscription_id);
    const tier = tierFromPlanId(ppSub.plan_id);

    if (ppSub.status === 'ACTIVE' && tier) {
      await updateUserTier(user.id, tier);
      await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'active',
          tier,
          current_period_start: ppSub.billing_info?.last_payment?.time || sub.current_period_start,
          current_period_end: ppSub.billing_info?.next_billing_time || sub.current_period_end,
        })
        .eq('paypal_subscription_id', sub.paypal_subscription_id);

      res.json({ synced: true, tier, message: `Synced to ${tier} tier` });
    } else if (ppSub.status === 'CANCELLED' || ppSub.status === 'SUSPENDED') {
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: ppSub.status.toLowerCase() })
        .eq('paypal_subscription_id', sub.paypal_subscription_id);

      // Check for other active subs before downgrading
      const { data: activeSubs } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (!activeSubs || activeSubs.length === 0) {
        await updateUserTier(user.id, 'free');
      }

      res.json({ synced: true, tier: 'free', message: `Subscription is ${ppSub.status}` });
    } else {
      res.json({ synced: false, message: `PayPal subscription status: ${ppSub.status}` });
    }
  } catch (err: any) {
    console.error('sync error:', err);
    res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

// ── Webhook Handlers ──────────────────────────────────────────────────

/** Process one-time payment by parsing custom_id. */
async function processOneTimePayment(customId: string) {
  const parts = customId.split(':');
  const userId = parts[0];
  const type = parts[1];

  if (type === 'credit') {
    const pack = parts[2];
    const credits = parseInt(pack, 10);
    if (credits > 0) {
      await addPurchasedCredits(userId, credits);
      const profile = await getProfile(userId);
      if (profile?.email) {
        sendCreditsPurchasedEmail(profile.email, credits).catch(() => {});
        const packInfo = CREDIT_PACK_PRICES[pack];
        if (packInfo) {
          createReceipt({
            customerEmail: profile.email,
            customerName: profile.name,
            amount: parseFloat(packInfo.price),
            currency: 'USD',
            description: `PackShot AI Credits (${credits})`,
          }).catch(() => {});
        }
      }
    }
  } else if (type === 'watermark') {
    await grantReward({
      userId,
      source: 'purchase_watermark',
      watermarkExports: 1,
      expiresInDays: null, // purchases never expire
    });
    const profile = await getProfile(userId);
    if (profile?.email) {
      const launchPromo = process.env.WATERMARK_LAUNCH_PROMO !== 'false';
      createReceipt({
        customerEmail: profile.email,
        customerName: profile.name,
        amount: launchPromo ? 1 : 2,
        currency: 'USD',
        description: 'PackShot Watermark Removal',
      }).catch(() => {});
    }
  }
}

/** Handle BILLING.SUBSCRIPTION.ACTIVATED — new subscription or renewal. */
async function handleSubscriptionActivated(resource: any) {
  const subscriptionId = resource.id;
  const customId = resource.custom_id;
  const planId = resource.plan_id;

  if (!customId || !subscriptionId) return;

  const userId = customId; // For subscriptions, custom_id is just the userId
  const tier = tierFromPlanId(planId);
  if (!tier) {
    console.error(`Unknown plan ID: ${planId}`);
    return;
  }

  // Store PayPal payer ID on profile
  const payerId = resource.subscriber?.payer_id;
  if (payerId) {
    await supabaseAdmin
      .from('profiles')
      .update({ paypal_payer_id: payerId })
      .eq('id', userId);
  }

  // Upsert subscription record
  const now = new Date().toISOString();
  const nextBilling = resource.billing_info?.next_billing_time;

  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      paypal_subscription_id: subscriptionId,
      tier,
      status: 'active',
      current_period_start: now,
      current_period_end: nextBilling || now,
      cancel_at_period_end: false,
    }, { onConflict: 'paypal_subscription_id' });

  // Update user tier and record when Pro started
  await updateUserTier(userId, tier);
  const profile = await getProfile(userId);
  if (profile && !profile.pro_started_at) {
    await supabaseAdmin.from('profiles').update({ pro_started_at: now }).eq('id', userId);
  }

  // Check for unsettled paid referral — issue referral_paid reward + check milestone
  const { data: refRow } = await supabaseAdmin
    .from('referrals')
    .select('*')
    .eq('referred_user_id', userId)
    .is('paid_reward_claimed_at', null)
    .maybeSingle();

  if (refRow) {
    await grantReward({
      userId: refRow.referrer_id,
      source: 'referral_paid',
      watermarkExports: 10,
      aiCredits: 10,
      expiresInDays: 90,
      referralId: refRow.id,
    });
    await supabaseAdmin
      .from('referrals')
      .update({
        became_paid_at: now,
        paid_reward_claimed_at: now,
      })
      .eq('id', refRow.id);

    // Milestone check: 10 paid referrals → 1 free Pro month
    const { count } = await supabaseAdmin
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', refRow.referrer_id)
      .not('became_paid_at', 'is', null);
    if (count && count >= 10) {
      const { granted } = await grantReward({
        userId: refRow.referrer_id,
        source: 'milestone_10_paid',
        proMonths: 1,
        expiresInDays: null,
      });
      if (granted) {
        const { data: refProfile } = await supabaseAdmin
          .from('profiles')
          .select('granted_pro_until')
          .eq('id', refRow.referrer_id)
          .single();
        const base = refProfile?.granted_pro_until && new Date(refProfile.granted_pro_until) > new Date()
          ? new Date(refProfile.granted_pro_until)
          : new Date();
        base.setMonth(base.getMonth() + 1);
        await supabaseAdmin
          .from('profiles')
          .update({ granted_pro_until: base.toISOString() })
          .eq('id', refRow.referrer_id);
      }
    }
  }

  // Send subscription confirmation email + issue receipt
  if (profile?.email) {
    sendSubscriptionConfirmedEmail(profile.email, tier).catch(() => {});

    // Determine subscription price for receipt
    const priceMap: Record<string, number> = {
      [process.env.PAYPAL_PLAN_PRO_MONTHLY || '']: 19,
      [process.env.PAYPAL_PLAN_PRO_YEARLY || '']: 200,
      [process.env.PAYPAL_PLAN_STUDIO_MONTHLY || '']: 49,
      [process.env.PAYPAL_PLAN_STUDIO_YEARLY || '']: 500,
    };
    const subPrice = priceMap[planId];
    if (subPrice) {
      createReceipt({
        customerEmail: profile.email,
        customerName: profile.name,
        amount: subPrice,
        currency: 'USD',
        description: `PackShot ${tier.charAt(0).toUpperCase() + tier.slice(1)} Subscription`,
      }).catch(() => {});
    }
  }
}

/** Handle BILLING.SUBSCRIPTION.CANCELLED — revert to free tier. */
async function handleSubscriptionCancelled(resource: any) {
  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('paypal_subscription_id', subscriptionId)
    .single();

  if (!sub) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('paypal_subscription_id', subscriptionId);

  // Check if user has any other active subscriptions
  const { data: activeSubs } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_id', sub.user_id)
    .eq('status', 'active');

  if (!activeSubs || activeSubs.length === 0) {
    await updateUserTier(sub.user_id, 'free');

    // Pro-freeze logic: shift all unexpired reward expiration dates forward
    const profile = await getProfile(sub.user_id);
    if (profile?.pro_started_at) {
      const proDurationMs = Date.now() - new Date(profile.pro_started_at).getTime();
      if (proDurationMs > 0) {
        await supabaseAdmin.rpc('shift_reward_expirations', {
          p_user_id: sub.user_id,
          p_interval_ms: proDurationMs,
        }).then(() => {}, () => {
          // If the RPC doesn't exist yet, skip silently
        });
      }
      await supabaseAdmin.from('profiles').update({ pro_started_at: null }).eq('id', sub.user_id);
    }

    // Send cancellation email
    if (profile?.email) {
      sendSubscriptionCancelledEmail(profile.email, profile.tier || 'pro', 'now').catch(() => {});
    }
  }
}

/** Handle BILLING.SUBSCRIPTION.SUSPENDED — payment failed. */
async function handleSubscriptionSuspended(resource: any) {
  const subscriptionId = resource.id;
  if (!subscriptionId) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('paypal_subscription_id', subscriptionId);
}

/** Handle BILLING.SUBSCRIPTION.UPDATED — plan change. */
async function handleSubscriptionUpdated(resource: any) {
  const subscriptionId = resource.id;
  const planId = resource.plan_id;
  if (!subscriptionId) return;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('paypal_subscription_id', subscriptionId)
    .single();

  if (!sub) return;

  const tier = tierFromPlanId(planId);
  const nextBilling = resource.billing_info?.next_billing_time;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      ...(tier ? { tier } : {}),
      ...(nextBilling ? { current_period_end: nextBilling } : {}),
    })
    .eq('paypal_subscription_id', subscriptionId);

  if (tier) {
    await updateUserTier(sub.user_id, tier);
  }
}

/** Handle PAYMENT.SALE.COMPLETED — recurring payment processed. */
async function handlePaymentCompleted(resource: any) {
  const subscriptionId = resource.billing_agreement_id;
  if (!subscriptionId) return;

  // Update period dates from the PayPal subscription
  try {
    const ppSub = await getSubscription(subscriptionId);
    const nextBilling = ppSub.billing_info?.next_billing_time;
    if (nextBilling) {
      await supabaseAdmin
        .from('subscriptions')
        .update({
          current_period_start: new Date().toISOString(),
          current_period_end: nextBilling,
          status: 'active',
        })
        .eq('paypal_subscription_id', subscriptionId);
    }
  } catch (err) {
    console.error('Failed to update period dates after payment:', err);
  }
}

/** Handle CHECKOUT.ORDER.APPROVED — one-time payment approved server-side. */
async function handleOrderApproved(resource: any) {
  const orderId = resource.id;
  if (!orderId) return;

  try {
    // Capture the order first
    const capture = await captureOrder(orderId);
    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id
      || capture.purchase_units?.[0]?.custom_id;

    if (customId) {
      await processOneTimePayment(customId);
    }
  } catch (err) {
    console.error('Failed to capture order from webhook:', err);
  }
}

export { router as billingRouter };
