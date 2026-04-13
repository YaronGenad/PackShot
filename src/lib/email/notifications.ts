/**
 * Email notification system — sends transactional emails for billing events.
 * Uses a simple abstraction that can be backed by Supabase Edge Functions,
 * Resend, SendGrid, or any SMTP provider.
 *
 * For MVP, emails are queued to a database table and processed by an edge function.
 * If no email provider is configured, notifications are logged only.
 */

import pino from 'pino';
import { supabaseAdmin } from '../db/supabase.js';

const log = pino({ level: 'info' });

/** Email template types. */
export type EmailTemplate =
  | 'welcome'
  | 'subscription_confirmed'
  | 'subscription_cancelled'
  | 'usage_warning'
  | 'credits_purchased'
  | 'credits_low';

interface EmailPayload {
  to: string;
  template: EmailTemplate;
  data: Record<string, any>;
}

/**
 * Send a notification email. Non-blocking — logs on failure.
 * In production, this inserts into an `email_queue` table for async processing.
 * For MVP, it logs the email and optionally sends via configured provider.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const { to, template, data } = payload;

  log.info({ to, template, data }, `[email] Queuing ${template} email`);

  try {
    // Queue email in database for async processing
    await supabaseAdmin
      .from('email_queue')
      .insert({
        to_email: to,
        template,
        data,
        status: 'pending',
      });
  } catch (err: any) {
    // If email_queue table doesn't exist yet, just log
    log.warn({ err: err.message, to, template }, '[email] Failed to queue email (table may not exist)');
  }
}

/** Send welcome email on registration. */
export async function sendWelcomeEmail(email: string, name: string) {
  await sendEmail({
    to: email,
    template: 'welcome',
    data: {
      name,
      subject: 'Welcome to PackShot!',
      message: `Hi ${name}, welcome to PackShot! You can start processing RAW images immediately with the Free tier. Upgrade to Pro for full export formats and AI features.`,
    },
  });
}

/** Send subscription confirmation. */
export async function sendSubscriptionConfirmedEmail(email: string, tier: string) {
  await sendEmail({
    to: email,
    template: 'subscription_confirmed',
    data: {
      tier,
      subject: `PackShot ${tier.charAt(0).toUpperCase() + tier.slice(1)} — You're In!`,
      message: `Your ${tier} subscription is now active. Enjoy all the features!`,
    },
  });
}

/** Send subscription cancellation confirmation. */
export async function sendSubscriptionCancelledEmail(email: string, tier: string, periodEnd: string) {
  await sendEmail({
    to: email,
    template: 'subscription_cancelled',
    data: {
      tier,
      periodEnd,
      subject: `PackShot ${tier} Subscription Cancelled`,
      message: `Your ${tier} subscription has been cancelled. You'll retain access until ${periodEnd}.`,
    },
  });
}

/** Send usage warning at 90% quota. */
export async function sendUsageWarningEmail(email: string, used: number, limit: number, tier: string) {
  await sendEmail({
    to: email,
    template: 'usage_warning',
    data: {
      used,
      limit,
      tier,
      percent: Math.round((used / limit) * 100),
      subject: `PackShot Usage Alert — ${Math.round((used / limit) * 100)}% of Monthly Limit`,
      message: `You've used ${used} of your ${limit} monthly images. Consider upgrading or adjusting usage.`,
    },
  });
}

/** Send credit purchase confirmation. */
export async function sendCreditsPurchasedEmail(email: string, credits: number) {
  await sendEmail({
    to: email,
    template: 'credits_purchased',
    data: {
      credits,
      subject: `${credits} AI Credits Added to Your Account`,
      message: `${credits} AI credits have been added to your PackShot account. They never expire.`,
    },
  });
}

/** Send credits low warning. */
export async function sendCreditsLowEmail(email: string, remaining: number) {
  await sendEmail({
    to: email,
    template: 'credits_low',
    data: {
      remaining,
      subject: `Low AI Credits — ${remaining} Remaining`,
      message: `You have ${remaining} AI credits remaining. Buy more or add your own API key to continue using AI features.`,
    },
  });
}
