# PackShot — PayPal Billing Integration Sprint

> **Purpose:** Self-contained brief for implementing PayPal billing in PackShot.
> Run this in a fresh Claude Code session. Read this file first, then execute.
>
> **Repo:** https://github.com/YaronGenad/PackShot
> **Working directory:** `c:\Users\yaron\OneDrive - Newcinema\מאחד raw`

---

## Context — What PackShot Is

A professional web app that converts camera RAW focus brackets into sharp product packshots.

**Current stack:**
- Frontend: React 19 + TypeScript + Tailwind CSS 4 + Vite 6
- Backend: Express.js (server.ts) + Sharp + librawspeed + OpenCV.js (WASM) + ag-psd
- Database: Supabase (PostgreSQL + Auth)
- Auth: Supabase JWT cookies, optionalAuth middleware
- Current billing: Stripe SDK is integrated in code but **Stripe does not support Israel** for direct accounts. We're replacing it with **PayPal**.

**Business model — 3 tiers:**
- **Free:** 10 images/month, JPEG+PNG only, 2048px, watermark
- **Pro ($19/mo, $200/yr):** 500 images/month, all formats, 8192px, no watermark, AI credits purchasable
- **Studio ($49/mo, $500/yr):** 5000 images/month, 500 AI credits, REST API, priority support

---

## What Exists and What Needs to Change

### Currently in code (Stripe-based, needs replacement):

**`src/lib/billing/routes.ts`** — Express router mounted at `/api/billing`:
- `POST /api/billing/create-checkout` — Creates Stripe Checkout session → redirect
- `POST /api/billing/buy-credits` — One-time Stripe payment for AI credit packs
- `POST /api/billing/remove-watermark` — One-time $1/$2 Stripe payment
- `POST /api/billing/webhook` — Stripe webhook handler (checkout.session.completed, subscription.updated, subscription.deleted, invoice.payment_failed)
- `GET /api/billing/portal` — Stripe Customer Portal redirect
- `GET /api/billing/status` — Current billing status
- `POST /api/billing/sync` — Manual webhook catchup

**Key webhook handler function: `handleCheckoutCompleted`** (line ~283):
- Differentiates by `metadata.type`: 'credit_purchase', 'watermark_removal', or subscription
- On subscription: upserts to `subscriptions` table, updates user tier, checks referral rewards
- On credit purchase: calls `addPurchasedCredits()`
- On watermark removal: calls `grantReward()` with source 'purchase_watermark'

**`src/lib/auth-context.tsx`** — Frontend auth context:
- `createCheckout(tier, interval)` → fetch `/api/billing/create-checkout` → redirect to Stripe
- `buyCredits(pack)` → fetch `/api/billing/buy-credits` → redirect to Stripe
- `removeWatermark()` → fetch `/api/billing/remove-watermark` → redirect to Stripe
- `openBillingPortal()` → fetch `/api/billing/portal` → redirect to Stripe

**`src/components/PricingPage.tsx`** — Pricing display:
- Calls `createCheckout('pro', 'month')` etc. on button click

### What must NOT change:
- Supabase schema (profiles, subscriptions, usage, reward_claims tables)
- Tier enforcement logic (`src/lib/tier/limits.ts`)
- Rewards system (`src/lib/rewards/`)
- AI credits system (`src/lib/credits/`)
- All processing endpoints (focus-stack, export, process-raw)
- Auth middleware (`src/lib/auth/middleware.ts`)

---

## PayPal Live Credentials (ALREADY CONFIGURED)

All credentials are already in `.env`:

```
PAYPAL_CLIENT_ID=AQOQFTjF28bAjpnJc9JU7eJoN14uV3OHG0OebQg3yYLBakSNg5_wERAtsNo_6iqFzv9Aeugyczs4pz_H
PAYPAL_SECRET=EDRzr544bSCA5A7gEqzDUl832giSWyYQLOl9kNcBjjRO16CwaQYqaW1lACJiHZ2pieFnFFdgrLE_E7nI
PAYPAL_MODE=live
VITE_PAYPAL_CLIENT_ID=AQOQFTjF28bAjpnJc9JU7eJoN14uV3OHG0OebQg3yYLBakSNg5_wERAtsNo_6iqFzv9Aeugyczs4pz_H

PAYPAL_PLAN_PRO_MONTHLY=P-2GH43952MX881821DNHOMLLY
PAYPAL_PLAN_PRO_YEARLY=P-0TU85228UM485425HNHOMLLY
PAYPAL_PLAN_STUDIO_MONTHLY=P-88A00505F15207903NHOMLLY
PAYPAL_PLAN_STUDIO_YEARLY=P-3XT368736Y445993LNHOMLMA
```

**PayPal API base URL:** `https://api-m.paypal.com` (Live)
**Products already created:**
- `PROD-4S815411NC671774A` — PackShot Pro
- `PROD-0GE03963DT7486946` — PackShot Studio

**iCount (Israeli invoicing):**
```
ICOUNT_API_TOKEN=API3E8-C0A82A0C-69DCB7C3-CEC5DCEAF779962C
```

---

## PayPal API Overview

### Authentication
```
POST https://api-m.paypal.com/v1/oauth2/token
Authorization: Basic base64(CLIENT_ID:SECRET)
Content-Type: application/x-www-form-urlencoded
Body: grant_type=client_credentials
→ { access_token: "..." }
```
Cache the token for ~9 hours (it has `expires_in`).

### Subscriptions Flow
1. **Create Subscription** → returns `{ id, links: [{ rel: 'approve', href: '...' }] }`
2. **Redirect user** to the `approve` link → PayPal login/payment page
3. **User approves** → PayPal redirects back to `return_url` with `subscription_id` and `ba_token`
4. **Webhook** `BILLING.SUBSCRIPTION.ACTIVATED` fires → update user tier in DB
5. **Monthly billing** happens automatically. Webhook `PAYMENT.SALE.COMPLETED` fires each cycle.
6. **Cancellation:** call `POST /v1/billing/subscriptions/{id}/cancel` or user does it in PayPal

### Orders Flow (one-time payments: credits, watermark removal)
1. **Create Order** → returns `{ id, links: [{ rel: 'payer-action', href: '...' }] }`
2. **Redirect user** or use JS SDK popup
3. **User pays** → redirect back with `token` (order ID)
4. **Capture Order** → `POST /v2/checkout/orders/{id}/capture`
5. **Webhook** `CHECKOUT.ORDER.APPROVED` fires

### Webhook Events to Handle
- `BILLING.SUBSCRIPTION.ACTIVATED` — new sub or renewal
- `BILLING.SUBSCRIPTION.CANCELLED` — user cancelled
- `BILLING.SUBSCRIPTION.SUSPENDED` — payment failed
- `BILLING.SUBSCRIPTION.UPDATED` — plan change
- `PAYMENT.SALE.COMPLETED` — recurring payment processed
- `CHECKOUT.ORDER.APPROVED` — one-time payment approved (credits/watermark)

### Webhook Verification
PayPal webhooks include a `PAYPAL-TRANSMISSION-ID`, `PAYPAL-TRANSMISSION-TIME`, `PAYPAL-TRANSMISSION-SIG`, `PAYPAL-CERT-URL`, and `PAYPAL-AUTH-ALGO` header. Verify via:
```
POST /v1/notifications/verify-webhook-signature
{ webhook_id, transmission_id, transmission_time, cert_url, auth_algo, transmission_sig, webhook_event }
→ { verification_status: 'SUCCESS' }
```

---

## Implementation Tasks

### Task 1: Create PayPal API Client

**New file:** `src/lib/billing/paypal.ts`

This is the low-level helper that all billing code calls. It should:
- Cache access tokens (with expiry)
- Provide `paypalRequest(method, path, body)` helper
- Export functions:
  - `getAccessToken()` — cached
  - `createSubscription(planId, returnUrl, cancelUrl, customId)` — creates PayPal sub, returns approval URL
  - `getSubscription(subscriptionId)` — fetch current sub details
  - `cancelSubscription(subscriptionId, reason)` — cancel
  - `createOrder(amount, currency, description, customId, returnUrl, cancelUrl)` — for one-time payments
  - `captureOrder(orderId)` — capture approved order
  - `verifyWebhookSignature(headers, body, webhookId)` — verify webhook authenticity

**Pattern to follow:** The existing `src/lib/billing/routes.ts` already has a `getStripe()` lazy-init pattern. Replace it with `getPayPalToken()`.

**NPM packages available:** `@paypal/paypal-server-sdk` is installed but the raw REST API via `fetch` is simpler and more flexible for our needs. Use direct REST calls.

### Task 2: Rewrite Billing Routes

**File to modify:** `src/lib/billing/routes.ts`

Replace all Stripe logic with PayPal equivalents. The router stays at `/api/billing`.

**Endpoints to implement:**

1. **`POST /api/billing/create-checkout`** (subscription)
   - Body: `{ tier: 'pro'|'studio', interval: 'month'|'year' }`
   - Map tier+interval to PayPal Plan ID from env
   - Call `createSubscription(planId, returnUrl, cancelUrl, userId)`
   - Return `{ url: approvalUrl }`

2. **`POST /api/billing/buy-credits`** (one-time order)
   - Body: `{ pack: '50'|'120'|'300' }`
   - Price map: 50→$5, 120→$10, 300→$20
   - Call `createOrder(amount, 'USD', description, userId + ':credit:' + pack, returnUrl, cancelUrl)`
   - Return `{ url: approvalUrl }`

3. **`POST /api/billing/remove-watermark`** (one-time order)
   - Price: $1 (launch promo) or $2
   - Call `createOrder(amount, 'USD', 'Watermark removal', userId + ':watermark', returnUrl, cancelUrl)`
   - Return `{ url: approvalUrl }`

4. **`POST /api/billing/capture-order`** (NEW — called after PayPal redirect)
   - Body: `{ orderId: '...' }` (from URL query param after PayPal redirect)
   - Call `captureOrder(orderId)`
   - Parse `custom_id` to determine type (credit/watermark)
   - Issue credits or watermark removal reward
   - Return `{ success: true }`

5. **`POST /api/billing/webhook`** (PayPal webhooks)
   - Verify signature
   - Handle events:
     - `BILLING.SUBSCRIPTION.ACTIVATED` → find user by `custom_id`, update tier, upsert subscription, check referral rewards, send email
     - `BILLING.SUBSCRIPTION.CANCELLED` → revert to free tier, shift reward expirations
     - `BILLING.SUBSCRIPTION.SUSPENDED` → mark as past_due
     - `PAYMENT.SALE.COMPLETED` → update subscription period dates
     - `CHECKOUT.ORDER.APPROVED` → same as capture-order but triggered server-side

6. **`GET /api/billing/status`** — same as before (reads from Supabase)

7. **`GET /api/billing/portal`** — PayPal doesn't have a hosted portal. Instead:
   - Return `{ url: 'https://www.paypal.com/myaccount/autopay' }` — the PayPal auto-pay management page
   - Or build a simple in-app cancellation flow using `cancelSubscription()`

**Important integration points in the webhook handler:**
- After subscription activation, call the same referral/milestone code that currently exists (import `grantReward` from rewards.ts)
- After tier update, set `pro_started_at` on profiles
- After cancellation, shift reward expirations (same `handleSubscriptionDeleted` logic)
- For watermark removal orders, call `grantReward({ source: 'purchase_watermark', watermarkExports: 1 })`
- For credit purchases, call `addPurchasedCredits(userId, credits)`

### Task 3: Update the Subscriptions Table

The `subscriptions` table currently has `stripe_subscription_id`. We need to also support PayPal.

**Option A (recommended):** Rename the column or add a new one:
```sql
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT UNIQUE,
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;
```

Run this migration via Supabase Management API:
```
POST https://api.supabase.com/v1/projects/eqpnvxfccemmbulhczdb/database/query
Authorization: Bearer sbp_37b69f40bb3460fd4fce97e36cb17c69abfd43dd
Content-Type: application/json
{ "query": "ALTER TABLE ..." }
```

Also add `paypal_payer_id` column to `profiles` (PayPal's equivalent of Stripe customer ID):
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT;
```

### Task 4: Frontend — PayPal Checkout Integration

**Approach:** For subscriptions, use server-side subscription creation + redirect (like Stripe Checkout). For one-time payments (credits, watermark), use the PayPal JS SDK popup for better UX.

**Install:** `@paypal/react-paypal-js` is already installed.

**File to modify:** `src/lib/auth-context.tsx`

- `createCheckout(tier, interval)` — stays the same (POST to `/api/billing/create-checkout`, redirect to `data.url`)
- `buyCredits(pack)` — stays the same flow (redirect to PayPal)
- `removeWatermark()` — stays the same flow (redirect to PayPal)
- `openBillingPortal()` — redirect to `https://www.paypal.com/myaccount/autopay`

**File to modify:** `src/App.tsx`

Add handler for PayPal return URLs. After PayPal redirect back, the URL contains:
- For subscriptions: `?subscription_id=I-xxx&ba_token=xxx`
- For orders: `?token=xxx` (this is the order ID)

On mount, check for these params:
```typescript
const params = new URLSearchParams(window.location.search);
const subscriptionId = params.get('subscription_id');
const orderToken = params.get('token');

if (subscriptionId) {
  // Subscription was approved — webhook will handle the tier update
  // Show success message, clean URL
  setPage('account');
  window.history.replaceState({}, '', window.location.pathname);
}

if (orderToken && !subscriptionId) {
  // One-time order approved — capture it
  fetch('/api/billing/capture-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ orderId: orderToken }),
  }).then(() => {
    setPage('account');
    window.history.replaceState({}, '', window.location.pathname);
  });
}
```

### Task 5: PayPal Webhook Registration

After the billing routes are deployed, register a webhook in PayPal:

**Via API:**
```
POST https://api-m.paypal.com/v1/notifications/webhooks
{
  "url": "https://pack-shot.studio/api/billing/webhook",
  "event_types": [
    { "name": "BILLING.SUBSCRIPTION.ACTIVATED" },
    { "name": "BILLING.SUBSCRIPTION.CANCELLED" },
    { "name": "BILLING.SUBSCRIPTION.SUSPENDED" },
    { "name": "BILLING.SUBSCRIPTION.UPDATED" },
    { "name": "PAYMENT.SALE.COMPLETED" },
    { "name": "CHECKOUT.ORDER.APPROVED" }
  ]
}
→ { id: "WH-xxx" }
```

Store the webhook ID in `.env` as `PAYPAL_WEBHOOK_ID` (needed for signature verification).

**For local development:** Use ngrok or skip verification (check `NODE_ENV !== 'production'`).

### Task 6: iCount Receipt Integration

**New file:** `src/lib/invoicing/icount.ts`

iCount API (Hebrew invoicing system for Israeli businesses):
- Base URL: `https://api.icount.co.il`
- Auth: API token in header
- Token: `API3E8-C0A82A0C-69DCB7C3-CEC5DCEAF779962C`

**Functions:**
- `createReceipt(params: { customerEmail, customerName, amount, currency, description, docLang? })` → creates receipt (קבלה) and sends PDF to customer email
- API call: `POST /api/v3.php/doc/create`

**Call from:** billing webhook handler, after every successful payment (subscription activation, credit purchase, watermark removal).

**Note:** The owner is עוסק פטור (exempt dealer) in Israel — receipts only, no tax invoices. The receipt should say "קבלה" (receipt), not "חשבונית מס" (tax invoice).

### Task 7: Remove Stripe Dependencies

After PayPal is working:
- Remove `stripe` from package.json: `npm uninstall stripe`
- Remove Stripe env vars from `.env.example`
- Keep `@google/genai` (used for AI via server proxy)
- Update `server.ts` if it imports Stripe anywhere

### Task 8: Update .env.example

Add all PayPal vars, remove Stripe vars, add iCount vars.

---

## Implementation Order

1. **Migration** — Add paypal columns to subscriptions/profiles (Task 3)
2. **PayPal client** — `src/lib/billing/paypal.ts` (Task 1)
3. **Billing routes** — Rewrite `src/lib/billing/routes.ts` (Task 2)
4. **Frontend return handler** — App.tsx capture flow (Task 4)
5. **iCount integration** — `src/lib/invoicing/icount.ts` (Task 6)
6. **Build + test** — Verify subscription + one-time payment flows
7. **Webhook registration** — Register PayPal webhook for production URL (Task 5)
8. **Cleanup** — Remove Stripe, update docs (Task 7, 8)

---

## Testing

### Local testing (before deployment):

1. **Start server:** `npm run dev`
2. **Test subscription flow:**
   - Log in as test user
   - Click "Upgrade to Pro" on pricing page
   - Should redirect to PayPal
   - **Use a real PayPal account** (Live mode — this is real money, use $19 Pro monthly)
   - After approval, should redirect back to `localhost:3000?subscription_id=...`
   - Tier should update in DB (verify via Supabase dashboard)

3. **Test one-time payment:**
   - Click "Buy 50 AI Credits" or "Remove Watermark"
   - Should redirect to PayPal → pay → redirect back
   - Credits/watermark claim should appear in DB

4. **Test webhook (requires public URL):**
   - Use ngrok: `ngrok http 3000`
   - Register webhook with ngrok URL
   - Verify events arrive and are processed

### Database verification:
```sql
SELECT * FROM profiles WHERE email = 'your@email.com';
SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 5;
SELECT * FROM usage WHERE user_id = 'xxx';
SELECT * FROM reward_claims WHERE user_id = 'xxx';
```

---

## Key Files Reference

| File | Purpose | Action |
|------|---------|--------|
| `src/lib/billing/paypal.ts` | NEW — PayPal API client | Create |
| `src/lib/billing/routes.ts` | Billing routes | Rewrite (Stripe → PayPal) |
| `src/lib/invoicing/icount.ts` | NEW — iCount receipt issuance | Create |
| `src/lib/auth-context.tsx` | Frontend auth + billing actions | Minor update (portal URL) |
| `src/App.tsx` | Root component | Add PayPal return URL handler |
| `src/components/PricingPage.tsx` | Pricing display | No change needed (calls createCheckout) |
| `server.ts` | Express server | No change needed (billing router already mounted) |
| `src/lib/auth/middleware.ts` | Auth middleware | No change needed |
| `src/lib/tier/limits.ts` | Tier enforcement | No change needed |
| `src/lib/rewards/rewards.ts` | Rewards system | No change needed (grantReward stays same) |
| `src/lib/credits/ai-credits.ts` | AI credits | No change needed (addPurchasedCredits stays same) |
| `src/lib/db/supabase.ts` | Supabase helpers | No change needed |
| `supabase/migrations/005_paypal.sql` | NEW — PayPal columns | Create + run |

---

## Existing Patterns to Follow

### How `grantReward` works (from `src/lib/rewards/rewards.ts`):
```typescript
await grantReward({
  userId: string,
  source: 'purchase_watermark' | 'referral_paid' | 'milestone_10_paid',
  watermarkExports?: number,
  aiCredits?: number,
  proMonths?: number,
  expiresInDays?: number | null,
  referralId?: string,
});
```

### How `addPurchasedCredits` works (from `src/lib/credits/ai-credits.ts`):
```typescript
await addPurchasedCredits(userId: string, credits: number);
```

### How tier update works (from `src/lib/db/supabase.ts`):
```typescript
await updateUserTier(userId: string, tier: 'free' | 'pro' | 'studio');
```

### How subscriptions are stored:
```typescript
await supabaseAdmin.from('subscriptions').upsert({
  user_id: userId,
  stripe_subscription_id: '...', // will be paypal_subscription_id instead
  tier: 'pro' | 'studio',
  status: 'active' | 'cancelled' | 'past_due',
  current_period_start: '...',
  current_period_end: '...',
  cancel_at_period_end: false,
});
```

### How referral rewards are issued on subscription (in `handleCheckoutCompleted`):
After updating tier, check for unsettled referral:
```typescript
const { data: refRow } = await supabaseAdmin
  .from('referrals')
  .select('*')
  .eq('referred_user_id', userId)
  .is('paid_reward_claimed_at', null)
  .maybeSingle();

if (refRow) {
  await grantReward({ userId: refRow.referrer_id, source: 'referral_paid', watermarkExports: 10, aiCredits: 10, expiresInDays: 90, referralId: refRow.id });
  // + milestone check (see existing code)
}
```

### Supabase Management API (for running migrations):
```
POST https://api.supabase.com/v1/projects/eqpnvxfccemmbulhczdb/database/query
Authorization: Bearer sbp_37b69f40bb3460fd4fce97e36cb17c69abfd43dd
Content-Type: application/json
{ "query": "SQL HERE" }
```

---

## PayPal Return/Cancel URLs

For local development:
- Return: `http://localhost:3000/?checkout=success`
- Cancel: `http://localhost:3000/?checkout=cancelled`

For production:
- Return: `https://pack-shot.studio/?checkout=success`
- Cancel: `https://pack-shot.studio/?checkout=cancelled`

Use `process.env.APP_URL || 'http://localhost:3000'` as the base.

For subscriptions, PayPal appends `&subscription_id=I-xxx&ba_token=xxx` to the return URL automatically.
For orders, PayPal appends `&token=ORDER_ID` to the return URL.

---

## Custom ID Encoding (for identifying payment type in webhook)

PayPal subscriptions accept a `custom_id` field (max 127 chars). We'll encode:
- Subscriptions: `userId` (plain UUID — tier comes from the plan ID)
- Credit orders: `userId:credit:50` or `userId:credit:120` or `userId:credit:300`
- Watermark orders: `userId:watermark`

Parse in webhook handler to route to correct action.
