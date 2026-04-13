/**
 * Webhook system — register URLs, fire events with HMAC-SHA256 signatures.
 * Events: job.completed, job.failed, credits.low
 */

import crypto from 'crypto';
import { Router, Response } from 'express';
import { supabaseAdmin } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import pino from 'pino';

const log = pino({ level: 'info' });
const router = Router();

/** Webhook events. */
export type WebhookEvent = 'job.completed' | 'job.failed' | 'credits.low';

/** Generate HMAC-SHA256 signature for webhook payload. */
function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * POST /api/settings/webhooks — Register a webhook URL.
 * Body: { url: string, events?: string[], secret?: string }
 */
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    if (user.tier !== 'studio') {
      return res.status(403).json({ error: 'Webhooks require Studio tier' });
    }

    const { url, events, secret } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Generate a signing secret if not provided
    const signingSecret = secret || crypto.randomBytes(32).toString('hex');
    const allowedEvents = events || ['job.completed', 'job.failed', 'credits.low'];

    // Check for existing webhook for this user
    const { data: existing } = await supabaseAdmin
      .from('webhooks')
      .select('id')
      .eq('user_id', user.id)
      .single();

    if (existing) {
      // Update existing
      await supabaseAdmin
        .from('webhooks')
        .update({ url, events: allowedEvents, signing_secret: signingSecret })
        .eq('id', existing.id);
    } else {
      // Insert new
      await supabaseAdmin
        .from('webhooks')
        .insert({
          user_id: user.id,
          url,
          events: allowedEvents,
          signing_secret: signingSecret,
        });
    }

    res.json({
      success: true,
      url,
      events: allowedEvents,
      signing_secret: signingSecret,
      message: 'Save the signing secret — use it to verify webhook signatures.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to register webhook' });
  }
});

/**
 * GET /api/settings/webhooks — Get webhook configuration.
 */
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const { data } = await supabaseAdmin
      .from('webhooks')
      .select('id, url, events, created_at')
      .eq('user_id', user.id)
      .single();

    res.json({ webhook: data || null });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch webhook config' });
  }
});

/**
 * DELETE /api/settings/webhooks — Remove webhook.
 */
router.delete('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await supabaseAdmin
      .from('webhooks')
      .delete()
      .eq('user_id', req.user!.id);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

/**
 * Fire a webhook event to a user's registered URL.
 * Non-blocking — fires and forgets (with retry on failure).
 */
export async function fireWebhook(
  userId: string,
  event: WebhookEvent,
  data: Record<string, any>
): Promise<void> {
  try {
    const { data: webhook } = await supabaseAdmin
      .from('webhooks')
      .select('url, signing_secret, events')
      .eq('user_id', userId)
      .single();

    if (!webhook) return;

    // Check if this event is subscribed
    if (webhook.events && !webhook.events.includes(event)) return;

    const payload = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });

    const signature = signPayload(payload, webhook.signing_secret);

    // Fire webhook with retry
    const attemptFetch = async (attempt: number) => {
      try {
        const res = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PackShot-Signature': signature,
            'X-PackShot-Event': event,
          },
          body: payload,
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (!res.ok && attempt < 3) {
          // Retry with exponential backoff
          setTimeout(() => attemptFetch(attempt + 1), 1000 * Math.pow(2, attempt));
        }
      } catch (err) {
        if (attempt < 3) {
          setTimeout(() => attemptFetch(attempt + 1), 1000 * Math.pow(2, attempt));
        } else {
          log.warn({ userId, event, url: webhook.url }, 'Webhook delivery failed after 3 attempts');
        }
      }
    };

    // Fire async — don't block the response
    attemptFetch(0);
  } catch (err) {
    // Silent fail — webhooks are best-effort
  }
}

export { router as webhooksRouter };
