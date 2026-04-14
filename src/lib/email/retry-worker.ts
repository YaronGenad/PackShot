/**
 * Email retry worker — processes failed emails from the email_queue table.
 * Called from the interval in server.ts. Gives up after MAX_RETRIES attempts.
 */

import pino from 'pino';
import { supabaseAdmin } from '../db/supabase.js';

const log = pino({ level: 'info' });

const MAX_RETRIES = 3;
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.FROM_EMAIL || 'PackShot Studio <noreply@pack-shot.studio>';

function renderEmail(data: Record<string, any>): { subject: string; html: string } {
  const subject = data.subject || 'PackShot Notification';
  const message = data.message || '';
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px">
      <div style="text-align:center;margin-bottom:32px">
        <span style="font-size:24px;font-weight:700;color:#f97316;text-transform:uppercase;letter-spacing:-0.05em">PackShot</span>
        <span style="font-size:10px;color:#9ca3af;display:block;text-transform:uppercase;letter-spacing:0.3em;margin-top:4px">Studio</span>
      </div>
      <div style="background:#f9fafb;border-radius:12px;padding:24px;margin-bottom:24px">
        <p style="color:#111827;font-size:15px;line-height:1.6;margin:0">${message}</p>
      </div>
      <div style="text-align:center;color:#9ca3af;font-size:12px">
        <a href="https://pack-shot.studio" style="color:#f97316;text-decoration:none">pack-shot.studio</a>
      </div>
    </div>
  `;
  return { subject, html };
}

export async function runEmailRetry(batchSize = 20): Promise<{ processed: number; sent: number; gaveUp: number }> {
  if (!RESEND_API_KEY) return { processed: 0, sent: 0, gaveUp: 0 };

  // Retry failed rows less than 24h old, and any pending row from a previous dev-mode run
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await supabaseAdmin
    .from('email_queue')
    .select('*')
    .in('status', ['failed', 'pending'])
    .lt('retry_count', MAX_RETRIES)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!rows || rows.length === 0) return { processed: 0, sent: 0, gaveUp: 0 };

  let sent = 0;
  let gaveUp = 0;

  for (const row of rows) {
    const nextRetry = (row.retry_count || 0) + 1;
    try {
      const { subject, html } = renderEmail(row.data || {});
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: FROM_EMAIL, to: row.to_email, subject, html }),
      });

      if (res.ok) {
        await supabaseAdmin
          .from('email_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString(), retry_count: nextRetry, error: null })
          .eq('id', row.id);
        sent++;
        continue;
      }

      const body = await res.text();
      const finalStatus = nextRetry >= MAX_RETRIES ? 'failed' : 'failed';
      await supabaseAdmin
        .from('email_queue')
        .update({ status: finalStatus, retry_count: nextRetry, error: body.slice(0, 500) })
        .eq('id', row.id);
      if (nextRetry >= MAX_RETRIES) gaveUp++;
    } catch (err: any) {
      await supabaseAdmin
        .from('email_queue')
        .update({
          status: 'failed',
          retry_count: nextRetry,
          error: String(err?.message || err).slice(0, 500),
        })
        .eq('id', row.id);
      if (nextRetry >= MAX_RETRIES) gaveUp++;
    }
  }

  log.info({ processed: rows.length, sent, gaveUp }, 'Email retry worker completed');
  return { processed: rows.length, sent, gaveUp };
}
