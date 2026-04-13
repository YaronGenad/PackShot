/**
 * Stripe billing routes — checkout sessions, webhooks, customer portal.
 * Handles subscription lifecycle: create, renew, cancel, upgrade/downgrade.
 */

import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { supabaseAdmin, updateUserTier, getProfile } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import { addPurchasedCredits } from '../credits/ai-credits.js';
import { grantReward } from '../rewards/rewards.js';
import { sendSubscriptionConfirmedEmail, sendSubscriptionCancelledEmail, sendCreditsPurchasedEmail } from '../email/notifications.js';

const router = Router();

/** Stripe client — initialized lazily to allow missing key in dev. */
let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    stripe = new Stripe(key, { apiVersion: '2025-03-31.basil' as any });
  }
  return stripe;
}

/** Map Stripe credit price IDs to credit amounts. Populated eagerly on import. */
const CREDIT_PACKS: Record<string, number> = {};
function initCreditPacks() {
  if (process.env.STRIPE_PRICE_CREDITS_50) CREDIT_PACKS[process.env.STRIPE_PRICE_CREDITS_50] = 50;
  if (process.env.STRIPE_PRICE_CREDITS_120) CREDIT_PACKS[process.env.STRIPE_PRICE_CREDITS_120] = 120;
  if (process.env.STRIPE_PRICE_CREDITS_300) CREDIT_PACKS[process.env.STRIPE_PRICE_CREDITS_300] = 300;
}
// Initialize credit packs mapping on module load
initCreditPacks();

/** Map Stripe price IDs to tiers. */
function tierFromPriceId(priceId: string): 'pro' | 'studio' | null {
  const proPrices = [
    process.env.STRIPE_PRICE_PRO_MONTHLY,
    process.env.STRIPE_PRICE_PRO_YEARLY,
  ].filter(Boolean);
  const studioPrices = [
    process.env.STRIPE_PRICE_STUDIO_MONTHLY,
    process.env.STRIPE_PRICE_STUDIO_YEARLY,
  ].filter(Boolean);

  if (proPrices.includes(priceId)) return 'pro';
  if (studioPrices.includes(priceId)) return 'studio';
  return null;
}

/**
 * POST /api/billing/create-checkout — Create Stripe Checkout session for subscription.
 */
router.post('/create-checkout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { tier, interval = 'month' } = req.body;
    const user = req.user!;

    if (!['pro', 'studio'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be "pro" or "studio".' });
    }

    const s = getStripe();

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        metadata: { packshot_user_id: user.id },
      });
      customerId = customer.id;

      // Save Stripe customer ID to profile
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    // Determine price ID
    let priceId: string | undefined;
    if (tier === 'pro') {
      priceId = interval === 'year'
        ? process.env.STRIPE_PRICE_PRO_YEARLY
        : process.env.STRIPE_PRICE_PRO_MONTHLY;
    } else {
      priceId = interval === 'year'
        ? process.env.STRIPE_PRICE_STUDIO_YEARLY
        : process.env.STRIPE_PRICE_STUDIO_MONTHLY;
    }

    if (!priceId) {
      return res.status(500).json({ error: `Price not configured for ${tier}/${interval}` });
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}?checkout=cancelled`,
      metadata: {
        packshot_user_id: user.id,
        tier,
        interval,
      },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

/**
 * POST /api/billing/buy-credits — Purchase AI credit pack via Stripe.
 * Body: { pack: '50' | '120' | '300' }
 */
router.post('/buy-credits', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pack } = req.body;
    const user = req.user!;

    // Validate tier — only Pro and Studio can buy credits
    if (user.tier === 'free') {
      return res.status(403).json({
        error: 'AI credits require a Pro or Studio subscription',
        upgrade: 'pro',
      });
    }

    // Map pack to price ID
    const packMap: Record<string, string | undefined> = {
      '50': process.env.STRIPE_PRICE_CREDITS_50,
      '120': process.env.STRIPE_PRICE_CREDITS_120,
      '300': process.env.STRIPE_PRICE_CREDITS_300,
    };

    const priceId = packMap[pack];
    if (!priceId) {
      return res.status(400).json({ error: 'Invalid credit pack. Choose 50, 120, or 300.' });
    }

    const s = getStripe();

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        metadata: { packshot_user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}?credits=success&pack=${pack}`,
      cancel_url: `${appUrl}?credits=cancelled`,
      metadata: {
        packshot_user_id: user.id,
        type: 'credit_purchase',
        credits: pack,
      },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create credit checkout', details: err.message });
  }
});

/**
 * POST /api/billing/remove-watermark — One-time $2 payment ($1 launch) to remove watermark on next export.
 * Uses Stripe dynamic pricing so we don't need a pre-created product.
 */
router.post('/remove-watermark', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const s = getStripe();

    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({ email: user.email, metadata: { packshot_user_id: user.id } });
      customerId = customer.id;
      await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
    }

    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    // Launch promo: $1 instead of $2
    const launchPromo = process.env.WATERMARK_LAUNCH_PROMO !== 'false';
    const amount = launchPromo ? 100 : 200; // cents

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Watermark Removal (one-time)', description: 'Remove "Made with PackShot" watermark from your next export' },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      success_url: `${appUrl}?watermark=removed`,
      cancel_url: `${appUrl}?watermark=cancelled`,
      metadata: { packshot_user_id: user.id, type: 'watermark_removal' },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create checkout session', details: err.message });
  }
});

/**
 * POST /api/billing/webhook — Stripe webhook handler.
 * IMPORTANT: This endpoint must receive raw body (not JSON-parsed).
 */
router.post('/webhook', async (req: Request, res: Response) => {
  try {
    const s = getStripe();
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    let event: Stripe.Event;
    try {
      event = s.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(s, session);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/** Handle successful checkout — subscription, credit purchase, or watermark removal. */
async function handleCheckoutCompleted(s: Stripe, session: Stripe.Checkout.Session) {
  const userId = session.metadata?.packshot_user_id;
  if (!userId) return;

  // Credit purchase (one-time payment)
  if (session.metadata?.type === 'credit_purchase') {
    const credits = parseInt(session.metadata.credits || '0', 10);
    if (credits > 0) {
      await addPurchasedCredits(userId, credits);
      const profile = await getProfile(userId);
      if (profile?.email) {
        sendCreditsPurchasedEmail(profile.email, credits).catch(() => {});
      }
    }
    return;
  }

  // Watermark removal (one-time payment) — persist as a reward_claims row
  if (session.metadata?.type === 'watermark_removal') {
    await grantReward({
      userId,
      source: 'purchase_watermark',
      watermarkExports: 1,
      expiresInDays: null, // purchases never expire
    });
    return;
  }

  // Subscription checkout
  const tier = session.metadata?.tier as 'pro' | 'studio';
  if (!tier) return;

  // Get full subscription details
  const subscriptionId = session.subscription as string;
  const subscription = await s.subscriptions.retrieve(subscriptionId);

  // Upsert subscription record
  await supabaseAdmin
    .from('subscriptions')
    .upsert({
      user_id: userId,
      stripe_subscription_id: subscription.id,
      tier,
      status: subscription.status,
      current_period_start: new Date(((subscription as any).current_period_start || 0) * 1000).toISOString(),
      current_period_end: new Date(((subscription as any).current_period_end || 0) * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    }, { onConflict: 'stripe_subscription_id' });

  // Update user tier and record when Pro started (for expiration-freeze logic)
  await updateUserTier(userId, tier);
  const profile = await getProfile(userId);
  if (profile && !profile.pro_started_at) {
    await supabaseAdmin.from('profiles').update({ pro_started_at: new Date().toISOString() }).eq('id', userId);
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
        became_paid_at: new Date().toISOString(),
        paid_reward_claimed_at: new Date().toISOString(),
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
        // Set granted_pro_until = GREATEST(now, current) + 1 month
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

  // Send subscription confirmation email
  if (profile?.email) {
    sendSubscriptionConfirmedEmail(profile.email, tier).catch(() => {});
  }
}

/** Handle subscription update (renewal, plan change). */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  // Determine tier from current price
  const priceId = subscription.items.data[0]?.price?.id;
  const tier = priceId ? tierFromPriceId(priceId) : null;

  await supabaseAdmin
    .from('subscriptions')
    .update({
      status: subscription.status,
      current_period_start: new Date(((subscription as any).current_period_start || 0) * 1000).toISOString(),
      current_period_end: new Date(((subscription as any).current_period_end || 0) * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
      ...(tier ? { tier } : {}),
    })
    .eq('stripe_subscription_id', subscription.id);

  // Update user tier if active
  if (subscription.status === 'active' && tier) {
    await updateUserTier(sub.user_id, tier);
  }
}

/** Handle subscription cancellation — revert to free tier. */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscription.id)
    .single();

  if (!sub) return;

  await supabaseAdmin
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('stripe_subscription_id', subscription.id);

  // Check if user has any other active subscriptions
  const { data: activeSubs } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('user_id', sub.user_id)
    .eq('status', 'active');

  if (!activeSubs || activeSubs.length === 0) {
    await updateUserTier(sub.user_id, 'free');

    // Pro-freeze logic: shift all unexpired reward expiration dates forward
    // by the duration spent on Pro, so the 3-month countdown effectively pauses.
    const profile = await getProfile(sub.user_id);
    if (profile?.pro_started_at) {
      const proDurationMs = Date.now() - new Date(profile.pro_started_at).getTime();
      if (proDurationMs > 0) {
        // Shift each unexpired claim's expires_at forward. This needs a raw SQL update.
        await supabaseAdmin.rpc('shift_reward_expirations', {
          p_user_id: sub.user_id,
          p_interval_ms: proDurationMs,
        }).then(() => {}, () => {
          // If the RPC doesn't exist yet (pre-migration), skip silently
        });
      }
      // Clear pro_started_at so the next upgrade restarts the clock
      await supabaseAdmin.from('profiles').update({ pro_started_at: null }).eq('id', sub.user_id);
    }

    // Send cancellation email
    if (profile?.email) {
      const endDate = (subscription as any).current_period_end
        ? new Date((subscription as any).current_period_end * 1000).toLocaleDateString()
        : 'now';
      sendSubscriptionCancelledEmail(profile.email, profile.tier || 'pro', endDate).catch(() => {});
    }
  }
}

/** Handle payment failure — mark subscription as past_due. */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = (invoice as any).subscription as string;
  if (!subscriptionId) return;

  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', subscriptionId)
    .single();

  if (sub) {
    await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('stripe_subscription_id', subscriptionId);
  }
}

/**
 * GET /api/billing/portal — Create Stripe Customer Portal session.
 */
router.get('/portal', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'No billing account found. Subscribe first.' });
    }

    const s = getStripe();
    const appUrl = process.env.APP_URL || 'http://localhost:3000';

    const session = await s.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: appUrl,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create portal session', details: err.message });
  }
});

/**
 * GET /api/billing/status — Get current billing status for authenticated user.
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
      has_stripe_customer: !!user.stripe_customer_id,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch billing status' });
  }
});

/**
 * POST /api/billing/sync — Manual subscription sync from Stripe.
 * Use if webhook missed an event. Re-checks Stripe for current subscription status.
 */
router.post('/sync', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!user.stripe_customer_id) {
      return res.json({ synced: false, message: 'No Stripe customer' });
    }

    const s = getStripe();

    // List active subscriptions from Stripe
    const subscriptions = await s.subscriptions.list({
      customer: user.stripe_customer_id,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length === 0) {
      // No active subscription — ensure user is on free tier
      await updateUserTier(user.id, 'free');
      return res.json({ synced: true, tier: 'free', message: 'No active subscription found' });
    }

    const sub = subscriptions.data[0];
    const priceId = sub.items.data[0]?.price?.id;
    const tier = priceId ? tierFromPriceId(priceId) : null;

    if (tier) {
      await updateUserTier(user.id, tier);

      // Upsert subscription record
      await supabaseAdmin
        .from('subscriptions')
        .upsert({
          user_id: user.id,
          stripe_subscription_id: sub.id,
          tier,
          status: sub.status,
          current_period_start: new Date(((sub as any).current_period_start || 0) * 1000).toISOString(),
          current_period_end: new Date(((sub as any).current_period_end || 0) * 1000).toISOString(),
          cancel_at_period_end: sub.cancel_at_period_end,
        }, { onConflict: 'stripe_subscription_id' });

      res.json({ synced: true, tier, message: `Synced to ${tier} tier` });
    } else {
      res.json({ synced: false, message: 'Could not determine tier from Stripe subscription' });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Sync failed', details: err.message });
  }
});

export { router as billingRouter };
