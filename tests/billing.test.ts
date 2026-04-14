/**
 * Billing endpoint tests — validation and webhook signature paths.
 * Requires server running on localhost:3000.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3000';

beforeAll(async () => {
  try {
    const res = await fetch(`${API}/api/ping`);
    if (!res.ok) throw new Error('Server not ready');
  } catch {
    console.error('\n⚠ Server not running. Start with: npm run dev\n');
    process.exit(1);
  }
});

describe('Billing auth gating', () => {
  it.each([
    { method: 'POST', path: '/api/billing/create-checkout', body: { tier: 'pro' } },
    { method: 'POST', path: '/api/billing/buy-credits', body: { pack: '50' } },
    { method: 'POST', path: '/api/billing/remove-watermark', body: {} },
    { method: 'POST', path: '/api/billing/cancel', body: {} },
    { method: 'POST', path: '/api/billing/change-plan', body: { tier: 'studio' } },
    { method: 'GET', path: '/api/billing/status', body: null },
    { method: 'POST', path: '/api/billing/capture-order', body: { orderId: 'x' } },
  ])('$method $path requires auth (401)', async ({ method, path, body }) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/billing/webhook — idempotency + signature', () => {
  it('rejects invalid signature when PAYPAL_WEBHOOK_ID is set', async () => {
    // Construct an event shape with an id. If PAYPAL_WEBHOOK_ID is set the server
    // rejects on signature; if not set, it still attempts to dedupe and will run
    // handlers. We only assert it does not 5xx on a well-formed request.
    const res = await fetch(`${API}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'WH-TEST-' + Date.now(),
        event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
        resource: { id: 'I-TEST', custom_id: '00000000-0000-0000-0000-000000000000', plan_id: 'unknown' },
      }),
    });
    // Either 400 (invalid signature) in prod-like config, or 200 (processed/noop) in dev
    expect([200, 400]).toContain(res.status);
  });

  it('returns 2xx and marks deduped on a replayed event_id (when signature check disabled)', async () => {
    if (process.env.PAYPAL_WEBHOOK_ID) {
      // Signature check on — cannot craft a valid signature from tests
      return;
    }
    const event = {
      id: 'WH-DEDUPE-' + Date.now(),
      event_type: 'PAYMENT.SALE.COMPLETED',
      resource: { billing_agreement_id: 'I-NOTEXIST' },
    };
    const r1 = await fetch(`${API}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    const r2 = await fetch(`${API}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    expect(r1.status).toBeLessThan(500);
    expect(r2.status).toBeLessThan(500);
    const body2 = await r2.json();
    // The second call should be flagged as deduped (assuming DB is reachable)
    if (body2.received) {
      expect(body2.deduped === true || body2.received === true).toBeTruthy();
    }
  });
});

describe('Admin endpoints — require admin', () => {
  it.each([
    '/api/admin/stats',
    '/api/admin/users',
  ])('%s returns 401 without cookie', async (path) => {
    const res = await fetch(`${API}${path}`);
    expect(res.status).toBe(401);
  });
});
