/**
 * Past-due subscription cleanup — runs daily.
 * When a PayPal subscription has been 'past_due' for more than GRACE_DAYS,
 * we downgrade the user to 'free' and mark the subscription cancelled.
 * Sends a notification email so the user isn't surprised.
 */

import pino from 'pino';
import { supabaseAdmin, updateUserTier, getProfile } from '../db/supabase.js';
import { sendSubscriptionCancelledEmail } from '../email/notifications.js';

const log = pino({ level: 'info' });

const GRACE_DAYS = 7;

export async function runPastDueCleanup(): Promise<{ processed: number; downgraded: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRACE_DAYS);

  const { data: stale } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, tier')
    .eq('status', 'past_due')
    .lt('updated_at', cutoff.toISOString());

  if (!stale || stale.length === 0) {
    return { processed: 0, downgraded: 0 };
  }

  let downgraded = 0;
  for (const sub of stale) {
    try {
      // Mark this subscription cancelled
      await supabaseAdmin
        .from('subscriptions')
        .update({ status: 'cancelled', cancel_at_period_end: true })
        .eq('id', sub.id);

      // Only downgrade the profile if no OTHER active subscriptions exist for this user
      const { data: active } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('user_id', sub.user_id)
        .eq('status', 'active');

      if (!active || active.length === 0) {
        await updateUserTier(sub.user_id, 'free');
        const profile = await getProfile(sub.user_id);
        if (profile?.email) {
          sendSubscriptionCancelledEmail(profile.email, sub.tier || 'pro', 'now').catch((err) => {
            log.warn({ err: err.message }, 'Failed to send past-due cancellation email');
          });
        }
        downgraded++;
        log.info({ userId: sub.user_id, subId: sub.id }, 'Past-due subscription downgraded to free');
      }
    } catch (err: any) {
      log.error({ err: err.message, subId: sub.id }, 'Past-due cleanup failed for subscription');
    }
  }

  return { processed: stale.length, downgraded };
}
