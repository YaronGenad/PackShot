/**
 * iCount receipt integration — Israeli invoicing for exempt dealer (עוסק פטור).
 * Issues receipts (קבלה) — NOT tax invoices — and sends PDF to customer email.
 */

import { supabaseAdmin } from '../db/supabase.js';

const ICOUNT_BASE = 'https://api.icount.co.il';

interface CreateReceiptParams {
  customerEmail: string;
  customerName?: string;
  amount: number;       // total in the payment currency
  currency: string;     // 'USD', 'ILS', etc.
  description: string;  // line item description
  docLang?: 'he' | 'en';
  userId?: string;      // for retry-queue tracking
}

/**
 * Create a receipt (קבלה) in iCount and email the PDF to the customer.
 * Returns the document number on success.
 */
/** Attempt the actual iCount REST call. Returns doc number or throws on failure. */
async function callIcount(params: CreateReceiptParams): Promise<string> {
  const token = process.env.ICOUNT_API_TOKEN;
  if (!token) throw new Error('ICOUNT_API_TOKEN not configured');

  const res = await fetch(`${ICOUNT_BASE}/api/v3.php/doc/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cid: token,
      doctype: 'receipt',         // קבלה (receipt), not invrec (tax invoice)
      lang: params.docLang || 'en',
      currency_code: params.currency,
      client_name: params.customerName || params.customerEmail,
      client_email: params.customerEmail,
      email_to_client: true,
      items: [{ description: params.description, quantity: 1, unitprice: params.amount }],
      payments: [{ payment_type: 4, payment_sum: params.amount }],
    }),
  });

  if (!res.ok) {
    throw new Error(`iCount HTTP ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  if (data.status !== true && data.status !== 'ok') {
    throw new Error(`iCount error: ${JSON.stringify(data)}`);
  }
  return data.doc_number;
}

/**
 * Create a receipt in iCount. On failure, enqueues the receipt in pending_receipts
 * so the background worker can retry. Never throws — safe to call without await-catching.
 */
export async function createReceipt(params: CreateReceiptParams): Promise<{ docNumber: string } | null> {
  if (!process.env.ICOUNT_API_TOKEN) {
    console.warn('iCount API token not configured — skipping receipt');
    return null;
  }

  try {
    const docNumber = await callIcount(params);
    console.log(`iCount receipt created: ${docNumber} for ${params.customerEmail}`);
    return { docNumber };
  } catch (err: any) {
    console.error('iCount receipt creation failed, queueing for retry:', err?.message || err);
    try {
      await supabaseAdmin.from('pending_receipts').insert({
        user_id: params.userId || null,
        customer_email: params.customerEmail,
        customer_name: params.customerName || null,
        amount: params.amount,
        currency: params.currency,
        description: params.description,
        status: 'pending',
        last_error: String(err?.message || err),
      });
    } catch (queueErr: any) {
      console.error('Failed to enqueue pending receipt:', queueErr?.message || queueErr);
    }
    return null;
  }
}

/**
 * Retry worker — process up to `batchSize` pending or failed receipts.
 * Called by the background interval in server.ts.
 */
export async function processPendingReceipts(batchSize = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (!process.env.ICOUNT_API_TOKEN) return { processed: 0, succeeded: 0, failed: 0 };

  const { data: rows } = await supabaseAdmin
    .from('pending_receipts')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lt('retry_count', 5)
    .order('created_at', { ascending: true })
    .limit(batchSize);

  if (!rows || rows.length === 0) return { processed: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const docNumber = await callIcount({
        customerEmail: row.customer_email,
        customerName: row.customer_name || undefined,
        amount: Number(row.amount),
        currency: row.currency,
        description: row.description,
      });
      await supabaseAdmin
        .from('pending_receipts')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id);
      succeeded++;
      console.log(`iCount retry: receipt ${docNumber} for ${row.customer_email}`);
    } catch (err: any) {
      const nextRetry = (row.retry_count || 0) + 1;
      await supabaseAdmin
        .from('pending_receipts')
        .update({
          status: nextRetry >= 5 ? 'failed' : 'pending',
          retry_count: nextRetry,
          last_error: String(err?.message || err),
        })
        .eq('id', row.id);
      failed++;
    }
  }
  return { processed: rows.length, succeeded, failed };
}
