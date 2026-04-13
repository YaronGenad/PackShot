/**
 * Email notification system — sends transactional emails via Resend.
 * Also logs to email_queue table for audit/retry.
 * If RESEND_API_KEY is not set, emails are logged only (dev mode).
 */

import pino from 'pino';
import { supabaseAdmin } from '../db/supabase.js';

const log = pino({ level: 'info' });

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PackShot Studio <noreply@pack-shot.studio>';

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

/** Render a simple HTML email from template + data. */
function renderEmail(template: EmailTemplate, data: Record<string, any>): { subject: string; html: string } {
  const subject = data.subject || `PackShot Notification`;
  const message = data.message || '';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <span style="font-size: 24px; font-weight: 700; color: #f97316; text-transform: uppercase; letter-spacing: -0.05em;">PackShot</span>
        <span style="font-size: 10px; color: #9ca3af; display: block; text-transform: uppercase; letter-spacing: 0.3em; margin-top: 4px;">Studio</span>
      </div>
      <div style="background: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <p style="color: #111827; font-size: 15px; line-height: 1.6; margin: 0;">${message}</p>
      </div>
      <div style="text-align: center; color: #9ca3af; font-size: 12px;">
        <a href="https://pack-shot.studio" style="color: #f97316; text-decoration: none;">pack-shot.studio</a>
        <span style="margin: 0 8px;">&middot;</span>
        <a href="mailto:support@pack-shot.studio" style="color: #9ca3af; text-decoration: none;">Support</a>
      </div>
    </div>
  `;

  return { subject, html };
}

/**
 * Send a notification email via Resend. Non-blocking — logs on failure.
 * Also records in email_queue for audit trail.
 */
export async function sendEmail(payload: EmailPayload): Promise<void> {
  const { to, template, data } = payload;

  log.info({ to, template }, `[email] Sending ${template} email`);

  // Record in DB for audit
  try {
    await supabaseAdmin
      .from('email_queue')
      .insert({
        to_email: to,
        template,
        data,
        status: RESEND_API_KEY ? 'sending' : 'pending',
      });
  } catch (err: any) {
    log.warn({ err: err.message, to, template }, '[email] Failed to queue email');
  }

  // Send via Resend if configured
  if (!RESEND_API_KEY) {
    log.info({ to, template }, '[email] RESEND_API_KEY not set — email logged only');
    return;
  }

  try {
    const { subject, html } = renderEmail(template, data);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.error({ to, template, status: res.status, body }, '[email] Resend API error');
      // Update queue status
      await supabaseAdmin
        .from('email_queue')
        .update({ status: 'failed', error: body })
        .eq('to_email', to)
        .eq('template', template)
        .eq('status', 'sending')
        .order('created_at', { ascending: false })
        .limit(1);
      return;
    }

    // Mark as sent
    await supabaseAdmin
      .from('email_queue')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('to_email', to)
      .eq('template', template)
      .eq('status', 'sending')
      .order('created_at', { ascending: false })
      .limit(1);

    log.info({ to, template }, '[email] Sent successfully via Resend');
  } catch (err: any) {
    log.error({ err: err.message, to, template }, '[email] Failed to send via Resend');
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
