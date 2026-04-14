/**
 * PayPal REST API client — low-level helpers for subscriptions, orders, and webhooks.
 * Uses direct REST calls to api-m.paypal.com (Live).
 */

const PAYPAL_BASE = 'https://api-m.paypal.com';

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Get a cached OAuth2 access token from PayPal. */
export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_SECRET;
  if (!clientId || !secret) throw new Error('PayPal credentials not configured');

  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
  };
  return cachedToken.token;
}

/** Generic PayPal API request helper. */
async function paypalRequest(method: string, path: string, body?: any): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  // Some PayPal endpoints return 204 No Content
  if (res.status === 204) return null;

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PayPal API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

/**
 * Create a PayPal subscription and return the approval URL.
 */
export async function createSubscription(
  planId: string,
  returnUrl: string,
  cancelUrl: string,
  customId: string,
): Promise<{ subscriptionId: string; approvalUrl: string }> {
  const data = await paypalRequest('POST', '/v1/billing/subscriptions', {
    plan_id: planId,
    custom_id: customId,
    application_context: {
      brand_name: 'PackShot',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });

  const approvalLink = data.links?.find((l: any) => l.rel === 'approve');
  if (!approvalLink) throw new Error('No approval URL in PayPal subscription response');

  return { subscriptionId: data.id, approvalUrl: approvalLink.href };
}

/** Fetch current subscription details from PayPal. */
export async function getSubscription(subscriptionId: string): Promise<any> {
  return paypalRequest('GET', `/v1/billing/subscriptions/${subscriptionId}`);
}

/** Cancel a PayPal subscription. */
export async function cancelSubscription(subscriptionId: string, reason: string): Promise<void> {
  await paypalRequest('POST', `/v1/billing/subscriptions/${subscriptionId}/cancel`, { reason });
}

/**
 * Revise a subscription to a different plan (upgrade/downgrade between Pro and Studio).
 * Returns an approval URL the user must visit to confirm the change.
 */
export async function reviseSubscription(
  subscriptionId: string,
  newPlanId: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ approvalUrl: string }> {
  const data = await paypalRequest('POST', `/v1/billing/subscriptions/${subscriptionId}/revise`, {
    plan_id: newPlanId,
    application_context: {
      brand_name: 'PackShot',
      locale: 'en-US',
      shipping_preference: 'NO_SHIPPING',
      user_action: 'SUBSCRIBE_NOW',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  });
  const approvalLink = data?.links?.find((l: any) => l.rel === 'approve');
  if (!approvalLink) throw new Error('No approval URL in PayPal revise response');
  return { approvalUrl: approvalLink.href };
}

/**
 * Create a PayPal order (one-time payment) and return the approval URL.
 */
export async function createOrder(
  amount: string,
  currency: string,
  description: string,
  customId: string,
  returnUrl: string,
  cancelUrl: string,
): Promise<{ orderId: string; approvalUrl: string }> {
  const data = await paypalRequest('POST', '/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      amount: { currency_code: currency, value: amount },
      description,
      custom_id: customId,
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'PackShot',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: returnUrl,
          cancel_url: cancelUrl,
        },
      },
    },
  });

  const approvalLink = data.links?.find((l: any) => l.rel === 'payer-action');
  if (!approvalLink) throw new Error('No approval URL in PayPal order response');

  return { orderId: data.id, approvalUrl: approvalLink.href };
}

/** Capture an approved PayPal order. Returns the full capture response. */
export async function captureOrder(orderId: string): Promise<any> {
  return paypalRequest('POST', `/v2/checkout/orders/${orderId}/capture`);
}

/** Verify a PayPal webhook signature. Returns true if valid. */
export async function verifyWebhookSignature(
  headers: Record<string, string>,
  body: string,
  webhookId: string,
): Promise<boolean> {
  const data = await paypalRequest('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers['paypal-auth-algo'],
    cert_url: headers['paypal-cert-url'],
    transmission_id: headers['paypal-transmission-id'],
    transmission_sig: headers['paypal-transmission-sig'],
    transmission_time: headers['paypal-transmission-time'],
    webhook_id: webhookId,
    webhook_event: JSON.parse(body),
  });

  return data?.verification_status === 'SUCCESS';
}
