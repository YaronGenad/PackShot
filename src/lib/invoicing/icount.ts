/**
 * iCount receipt integration — Israeli invoicing for exempt dealer (עוסק פטור).
 * Issues receipts (קבלה) — NOT tax invoices — and sends PDF to customer email.
 */

const ICOUNT_BASE = 'https://api.icount.co.il';

interface CreateReceiptParams {
  customerEmail: string;
  customerName?: string;
  amount: number;       // total in the payment currency
  currency: string;     // 'USD', 'ILS', etc.
  description: string;  // line item description
  docLang?: 'he' | 'en';
}

/**
 * Create a receipt (קבלה) in iCount and email the PDF to the customer.
 * Returns the document number on success.
 */
export async function createReceipt(params: CreateReceiptParams): Promise<{ docNumber: string } | null> {
  const token = process.env.ICOUNT_API_TOKEN;
  if (!token) {
    console.warn('iCount API token not configured — skipping receipt');
    return null;
  }

  try {
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
        items: [
          {
            description: params.description,
            quantity: 1,
            unitprice: params.amount,
          },
        ],
        payments: [
          {
            payment_type: 4,        // 4 = PayPal / other electronic payment
            payment_sum: params.amount,
          },
        ],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`iCount receipt creation failed (${res.status}):`, text);
      return null;
    }

    const data = await res.json();
    if (data.status !== true && data.status !== 'ok') {
      console.error('iCount receipt creation error:', data);
      return null;
    }

    console.log(`iCount receipt created: ${data.doc_number} for ${params.customerEmail}`);
    return { docNumber: data.doc_number };
  } catch (err) {
    console.error('iCount receipt creation exception:', err);
    return null;
  }
}
