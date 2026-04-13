# PackShot — Commercialization Sprint Runbook

> **Purpose:** This document is a self-contained brief for implementing the commercial version of PackShot.
> Each sprint can be executed in a separate Claude Code session. The session should read this file first
> to understand the full context, then execute the sprint tasks in order.
>
> **Repo:** https://github.com/YaronGenad/PackShot
> **Working directory:** `c:\Users\yaron\OneDrive - Newcinema\מאחד raw`

---

## What PackShot Is

A professional web app that converts camera RAW focus brackets into sharp product packshots (e-commerce photos).

**Three processing methods:**
1. **Quick Stack** — client-side Laplacian per-pixel selection (fast, no alignment)
2. **Aligned Stack** — server-side OpenCV AKAZE feature matching + Homography + multi-scale focus compositing (deterministic, no LLM)
3. **AI Synthesis** — Gemini 3.1 Flash Image via server proxy (non-deterministic, requires API key)

**Current stack:**
- Frontend: React 19 + TypeScript + Tailwind CSS 4 + Vite 6
- Backend: Express.js + Sharp + librawspeed (RAW decoding) + @techstark/opencv-js (WASM) + ag-psd (PSD read/write)
- AI: @google/genai (Gemini) — proxied through server, key never in client bundle
- Security: helmet, express-rate-limit, CORS whitelist, file magic validation, pino logging
- Testing: Vitest (19 API integration tests)
- Deployment: Dockerfile (multi-stage Alpine), docker-compose, GitHub Actions CI

**Key files:**
- `server.ts` (~600 lines) — All API endpoints, middleware, Gemini proxy
- `src/components/PackshotGenerator.tsx` (~1200 lines) — Main editor UI
- `src/components/RawUploader.tsx` (~300 lines) — File upload with validation
- `src/lib/focus-stack.ts` (~540 lines) — OpenCV alignment engine
- `src/lib/gemini.ts` (~220 lines) — Gemini API wrappers (LEGACY — calls now go through server)
- `tests/api.test.ts` — Integration tests

**Current API endpoints:**
- `POST /api/process-raw` — Upload RAW/PSD → extract preview (librawspeed/ag-psd/Sharp)
- `POST /api/focus-stack` — Aligned multi-image stacking (OpenCV WASM)
- `POST /api/export` — Convert to TIFF/JPEG/PNG/WebP/AVIF/PSD
- `POST /api/generate-packshot` — Gemini AI synthesis (server proxy)
- `POST /api/homogenize` — Gemini lighting correction (server proxy)
- `POST /api/edit-packshot` — Gemini targeted edit (server proxy)
- `GET/POST /api/has-gemini-key`, `/api/set-gemini-key`, `/api/reset-gemini-key` — Key management

---

## Business Model

### Free Tier — $0/month
- 10 images/month (no rollover)
- Quick Stack + Aligned Stack only
- Export: JPEG + PNG only
- Max resolution: 2048px
- Watermark: "Made with PackShot" on output
- Remove watermark: $2/image (launch promo: $1/image)

### Pro Tier — $19/month ($200/year — save 15%)
- 500 images/month (unused credits roll over 3 months, max 2,000 banked)
- Quick Stack + Aligned Stack + Multi-scale Laplacian
- All export formats (TIFF, PNG, PSD, JPEG, WebP, AVIF)
- Max resolution: 8192px (full sensor, no artificial limit)
- Upload up to 20 files at once
- No watermark
- Priority queue
- **AI add-ons (optional):**
  - Buy credits: $5/50, $10/120, $20/300
  - Or BYOK (Bring Your Own Key) — OpenAI, Gemini, Grok, Flux, etc.
- Soft warning at 90% usage. Overage: buy +100 pack for $5

### Studio Tier — $49/month ($500/year — save 15%)
- Unlimited deterministic images (soft limit: 5,000/month — contact us for more)
- 500 AI credits/month included (overage: $0.08/image, auto-billed)
- REST API access + webhooks
- Upload up to 50 files at once
- Priority support (24h response)
- Custom export presets
- BYOK optional for custom workflows
- Rate limit: 100 requests/minute
- AI hard cap: 500/month (auto-charge on overage)
- If deterministic >5K/month, contact for Enterprise plan

### BYOK (Bring Your Own Key) — Available in Pro + Studio
Users who already pay for an AI provider (OpenAI, Gemini, Grok, Flux, Stable Diffusion) can plug their own API key instead of buying credits. They pay us for the pipeline, not the AI. This:
- Lowers barrier for power users
- Allows provider choice (different models have different strengths/guardrails)
- Means we don't eat the API cost for heavy users

---

## Sprint Overview

| Sprint | Focus | Estimated Effort |
|--------|-------|-----------------|
| **S1** | Auth + User DB + Stripe billing | 2-3 days |
| **S2** | Tier enforcement (limits, watermark, format gating) | 2 days |
| **S3** | Credit system (AI credits, BYOK, usage tracking) | 2 days |
| **S4** | BYOK multi-provider (OpenAI, Grok, Flux adapters) | 2 days |
| **S5** | Studio API (REST keys, webhooks) | 1-2 days |
| **S6** | Frontend: pricing page, account dashboard, usage display | 2 days |
| **S7** | Polish, edge cases, billing emails, final testing | 1-2 days |

---

## Sprint 1 — Auth + User DB + Stripe Billing

### Context
Currently there are zero users, zero auth, zero persistence. Everything is anonymous and in-memory. We need:
- User registration/login (email + password, or OAuth)
- Persistent user database (Supabase or PostgreSQL + Prisma)
- Stripe subscription management (Free/Pro/Studio tiers)

### Tasks

#### S1.1 — Database Setup
- Choose DB: **Supabase** (hosted PostgreSQL + auth + row-level security) is the fastest path. Alternative: local PostgreSQL + Prisma.
- Schema:
  ```sql
  users: id, email, name, tier (free/pro/studio), stripe_customer_id, created_at
  subscriptions: id, user_id, stripe_subscription_id, tier, status (active/cancelled/past_due), current_period_start, current_period_end
  usage: id, user_id, month (YYYY-MM), deterministic_count, ai_count, last_reset
  api_keys: id, user_id, key_hash, name, created_at, last_used (for Studio API access)
  ```
- Add connection to `server.ts`

#### S1.2 — Authentication
- If Supabase: use `@supabase/supabase-js` (handles JWT, sessions, OAuth)
- If standalone: `bcrypt` + `jsonwebtoken` + `cookie-parser`
- Endpoints:
  - `POST /api/auth/register` — email + password → create user, set JWT cookie
  - `POST /api/auth/login` — email + password → verify, set JWT cookie
  - `POST /api/auth/logout` — clear cookie
  - `GET /api/auth/me` — return current user + tier + usage
- Middleware: `authMiddleware(req, res, next)` — verify JWT, set `req.user`
- Optional auth middleware for endpoints that work with/without login (Free tier anonymous?)

#### S1.3 — Stripe Integration
- `npm install stripe`
- Create Stripe products: Free, Pro ($19/mo, $200/yr), Studio ($49/mo, $500/yr)
- Endpoints:
  - `POST /api/billing/create-checkout` — redirect to Stripe Checkout
  - `POST /api/billing/webhook` — handle subscription.created, invoice.paid, subscription.cancelled, etc.
  - `GET /api/billing/portal` — redirect to Stripe Customer Portal (manage subscription)
- Webhook handler updates `subscriptions` table and user tier
- Environment vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_STUDIO_MONTHLY`, `STRIPE_PRICE_STUDIO_YEARLY`

#### S1.4 — Frontend Auth UI
- Login/Register modal (replace or extend ApiKeySelector)
- Show user name + tier in header
- "Upgrade to Pro" / "Upgrade to Studio" buttons
- Account settings page (change password, manage subscription via Stripe Portal)

### Verification
- Register → login → verify JWT in cookie → `/api/auth/me` returns user
- Create Stripe checkout → complete payment → webhook fires → user tier updated to Pro
- Stripe portal → cancel subscription → webhook fires → tier reverted to Free

---

## Sprint 2 — Tier Enforcement

### Context
With auth and billing in place, we need to actually enforce the tier limits in the processing pipeline.

### Tasks

#### S2.1 — Usage Tracking Middleware
- On each `POST /api/process-raw` or `/api/focus-stack` call:
  - Check `req.user.tier`
  - Query `usage` table for current month count
  - If over limit → return 402 with `{ error: "Monthly limit reached", code: "QUOTA_EXCEEDED", tier: "free", limit: 10, used: 10 }`
  - If under → increment count, proceed
- Create `checkQuota(tier)` middleware

#### S2.2 — Resolution Limiting
- Currently all images resize to max 2048px in `server.ts` (Sharp `.resize(2048, 2048, ...)`)
- Make dynamic: `const maxRes = tier === 'free' ? 2048 : 8192;`
- Apply in `/api/process-raw` optimization step

#### S2.3 — Export Format Gating
- Currently `/api/export` accepts any format
- Add check: if `tier === 'free'` and `format` not in `['jpeg', 'png']` → return 403
- Frontend: grey out unavailable formats with "Pro" badge

#### S2.4 — Upload Limit
- Currently multer allows 10 files
- Make dynamic: Free=10, Pro=20, Studio=50
- Apply in multer config per request

#### S2.5 — Watermark
- For Free tier: add text watermark to exported images before sending response
- Implementation: Sharp `.composite([{ input: watermarkBuffer, gravity: 'southeast' }])`
- Generate watermark PNG at startup: "Made with PackShot" in semi-transparent white text
- Pro/Studio: skip watermark
- Watermark removal purchase: one-time payment via Stripe ($2, promo $1)
  - `POST /api/billing/remove-watermark` — creates Stripe PaymentIntent for $2
  - On success: re-export without watermark, return clean image

#### S2.6 — Credit Rollover (Pro)
- Pro users: unused credits roll to next month, max 2,000 total banked
- `usage` table needs: `banked_credits` field
- At month boundary (or on first request of new month): `banked_credits = min(2000, banked_credits + (500 - last_month_used))`
- Available = current_month_remaining + banked_credits

### Verification
- Free user: 11th image returns 402
- Free user: export as TIFF returns 403
- Free user: output has watermark
- Pro user: no watermark, TIFF works, 500 limit
- Resolution: Free gets 2048px, Pro gets full sensor

---

## Sprint 3 — Credit System (AI)

### Context
AI features (generate-packshot, homogenize, edit) cost real money (Gemini API). Users can either buy credits from us or use their own key (BYOK).

### Tasks

#### S3.1 — AI Credit Tracking
- `usage` table: add `ai_credits_used`, `ai_credits_purchased`
- Studio: 500 included/month, overage at $0.08/image
- Pro: 0 included, must buy credits or BYOK
- Free: no AI access
- On each AI endpoint call:
  - Check tier allows AI
  - Check credits available (purchased + included - used)
  - If insufficient → return 402 with credit purchase link
  - If OK → deduct 1 credit, proceed

#### S3.2 — Credit Purchase (Stripe)
- Products: 50 credits/$5, 120 credits/$10, 300 credits/$20
- `POST /api/billing/buy-credits` — Stripe Checkout one-time payment
- Webhook: on payment success → add credits to user's `ai_credits_purchased`
- Credits don't expire (they're paid for)

#### S3.3 — BYOK (Bring Your Own Key) Storage
- `user_ai_keys` table: `id, user_id, provider (gemini/openai/grok/flux), encrypted_key, created_at`
- Encrypt keys at rest (AES-256 with server secret)
- `POST /api/settings/ai-key` — store encrypted key
- `GET /api/settings/ai-keys` — list providers (never return actual key)
- `DELETE /api/settings/ai-key/:provider` — remove key
- When BYOK key is set for a provider: use it instead of credits (free for user)

#### S3.4 — Frontend Credit Display
- Show remaining credits in header or generation panel
- "Buy Credits" button/modal
- BYOK settings page: add/remove keys per provider
- Clear indicator: "Using your Gemini key" vs "Using PackShot credits (47 remaining)"

### Verification
- Pro user without credits: AI buttons show "Buy Credits" or "Add Your Key"
- Pro user buys 50 credits → can run 50 AI operations
- Pro user with BYOK Gemini key → AI works, no credits deducted
- Studio user: 500 included → at 501 shows overage charge message
- Free user: AI buttons disabled with "Upgrade to Pro" tooltip

---

## Sprint 4 — BYOK Multi-Provider

### Context
Currently only Gemini is supported. Users want to use OpenAI (GPT-4o/DALL-E), Grok, Flux, or other providers. We need an adapter pattern.

### Tasks

#### S4.1 — AI Provider Adapter Interface
```typescript
interface AIProvider {
  name: string;
  generatePackshot(images: ImageInput[], prompt: string): Promise<string>; // returns base64
  homogenize(current: string, sources: ImageInput[], burnt: number, dark: number): Promise<string>;
  editImage(current: string, sources: ImageInput[], prompt: string): Promise<string>;
}
```

#### S4.2 — Gemini Adapter
- Extract current Gemini logic from server.ts into `src/lib/ai-providers/gemini.ts`
- Implement `AIProvider` interface

#### S4.3 — OpenAI Adapter
- `npm install openai`
- Implement using GPT-4o vision + DALL-E 3 image generation
- `src/lib/ai-providers/openai.ts`

#### S4.4 — Grok Adapter
- xAI API (compatible with OpenAI SDK format)
- `src/lib/ai-providers/grok.ts`

#### S4.5 — Provider Selection in Server
- Determine provider per request:
  1. Check user's BYOK keys → use matching provider
  2. If no BYOK → use default (Gemini with PackShot's key, deduct credits)
- Frontend: let user choose preferred provider in settings

#### S4.6 — Frontend Provider UI
- AI settings: dropdown to select provider
- Per-provider key input
- Badge showing active provider on generation buttons

### Verification
- User with OpenAI BYOK key: generation uses GPT-4o
- User with Gemini BYOK key: uses Gemini
- User with no BYOK key: uses PackShot credits (Gemini)
- Switch provider mid-session: next generation uses new provider

---

## Sprint 5 — Studio REST API

### Context
Studio tier includes API access for automation (headless processing).

### Tasks

#### S5.1 — API Key Management
- `POST /api/api-keys` — generate new API key (Studio only)
- `GET /api/api-keys` — list keys (masked)
- `DELETE /api/api-keys/:id` — revoke key
- Keys: random 32-byte hex, stored hashed (SHA-256)
- Auth: `Authorization: Bearer pk_live_xxx` header

#### S5.2 — API Authentication Middleware
- Check `Authorization` header for API key
- Look up hashed key in `api_keys` table
- Set `req.user` from associated user
- Apply same tier/quota checks

#### S5.3 — API Endpoints (JSON-only, no UI)
- Same endpoints as web UI but with API key auth:
  - `POST /api/v1/process` — upload RAW → get base64
  - `POST /api/v1/stack` — aligned focus stack
  - `POST /api/v1/export` — convert format
  - `POST /api/v1/ai/generate` — AI packshot
- Rate limit: 100 req/min per API key

#### S5.4 — Webhooks
- `POST /api/settings/webhooks` — register webhook URL
- Fire webhook on: job.completed, job.failed, credits.low
- Payload: `{ event, data, timestamp, signature }`
- HMAC-SHA256 signature for verification

### Verification
- Generate API key → use in curl → process image → get result
- Rate limit: 101st request in 1 minute → 429
- Webhook fires on job completion

---

## Sprint 6 — Frontend: Pricing + Dashboard

### Tasks

#### S6.1 — Pricing Page
- Three-column layout: Free / Pro / Studio
- Feature comparison table
- Annual/monthly toggle with "Save 15%" badge
- CTA buttons → Stripe Checkout

#### S6.2 — Account Dashboard
- Current tier + renewal date
- Usage bar: "42/500 images used this month"
- AI credits remaining
- Banked credits (Pro)
- Billing history (from Stripe)
- "Manage Subscription" → Stripe Portal

#### S6.3 — Usage Indicators in App
- Header: show tier badge + remaining count
- Generation panel: show "X credits remaining" for AI
- Export: grey out locked formats with tier badge
- Upload: show "X/20 files" limit indicator

#### S6.4 — Watermark Preview
- Free users: show watermark position preview before export
- "Remove watermark ($2)" button inline

### Verification
- Pricing page renders correctly with all tiers
- Dashboard shows accurate usage data
- Locked features show upgrade prompts
- Watermark visible in Free tier export preview

---

## Sprint 7 — Polish + Edge Cases

### Tasks

#### S7.1 — Billing Emails
- Welcome email on registration
- Subscription confirmation
- Payment receipt (Stripe handles this)
- Usage warning at 90% quota
- Subscription cancellation confirmation
- Credit purchase receipt

#### S7.2 — Edge Cases
- What happens when subscription lapses mid-month? → Downgrade to Free immediately
- What happens to banked credits on cancellation? → Frozen for 30 days, then expired
- What if BYOK key is invalid? → Clear error message, suggest checking key
- What if Stripe webhook fails? → Retry logic, manual sync endpoint
- Concurrent usage from multiple devices? → Usage is per-user, not per-session
- What if user exceeds 5K deterministic in Studio? → Soft warning at 4K, hard block at 5K with "Contact us" CTA

#### S7.3 — Legal
- Terms of Service page
- Privacy Policy page
- Cookie consent (if needed)
- Refund policy

#### S7.4 — Final Integration Testing
- Full flow: register → choose Pro → pay → upload RAW → aligned stack → crop → export PSD
- Full flow: Studio API key → curl upload → stack → export
- BYOK flow: set OpenAI key → AI generate → verify uses OpenAI
- Downgrade flow: cancel Pro → verify Free limits apply
- Credit flow: buy 50 → use 50 → verify blocked at 51 → buy more → works

---

## Technical Notes for Implementation

### Database Choice
Recommend **Supabase** for speed:
- Hosted PostgreSQL (no ops)
- Built-in auth (email, OAuth, magic links)
- Row-level security
- JS client: `@supabase/supabase-js`
- Free tier sufficient for MVP

### Stripe Integration Pattern
```
User clicks "Subscribe to Pro"
  → Frontend calls POST /api/billing/create-checkout { tier: 'pro', interval: 'month' }
  → Server creates Stripe Checkout Session
  → Returns checkout URL
  → Frontend redirects to Stripe
  → User pays
  → Stripe fires webhook to POST /api/billing/webhook
  → Server updates user tier in DB
  → User redirected back to app
```

### Watermark Implementation
```typescript
// Generate watermark PNG once at startup
const watermarkSvg = `<svg width="300" height="40"><text x="0" y="30" font-family="monospace" font-size="16" fill="rgba(255,255,255,0.4)">Made with PackShot</text></svg>`;
const watermarkBuffer = await sharp(Buffer.from(watermarkSvg)).png().toBuffer();

// Apply to export (Free tier only)
if (user.tier === 'free') {
  outputBuffer = await sharp(outputBuffer)
    .composite([{ input: watermarkBuffer, gravity: 'southeast' }])
    .toBuffer();
}
```

### BYOK Key Encryption
```typescript
import crypto from 'crypto';
const ENCRYPTION_KEY = process.env.BYOK_ENCRYPTION_KEY; // 32 bytes hex

function encryptKey(plainKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptKey(encryptedKey: string): string {
  const [ivHex, data] = encryptedKey.split(':');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

### Environment Variables Needed
```bash
# Database
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbG...

# Stripe
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PRICE_PRO_MONTHLY=price_xxx
STRIPE_PRICE_PRO_YEARLY=price_xxx
STRIPE_PRICE_STUDIO_MONTHLY=price_xxx
STRIPE_PRICE_STUDIO_YEARLY=price_xxx
STRIPE_PRICE_CREDITS_50=price_xxx
STRIPE_PRICE_CREDITS_120=price_xxx
STRIPE_PRICE_CREDITS_300=price_xxx
STRIPE_PRICE_WATERMARK_REMOVAL=price_xxx

# AI
GEMINI_API_KEY=xxx (server-only, for PackShot-provided AI)
BYOK_ENCRYPTION_KEY=xxx (32 bytes hex, for encrypting user API keys)

# App
ALLOWED_ORIGINS=https://packshot.io
NODE_ENV=production
```

---

## Execution Order Summary

```
S1 (Auth + DB + Stripe) → S2 (Tier Enforcement) → S3 (Credits + BYOK storage)
→ S4 (Multi-provider) → S5 (Studio API) → S6 (Frontend pages) → S7 (Polish)
```

Each sprint builds on the previous. S1 is the foundation — nothing else works without users and billing.
