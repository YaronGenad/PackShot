# PackShot Studio

Professional focus stacking and product photography tool. Converts camera RAW files into sharp, studio-quality packshots for e-commerce.

**Live at:** [pack-shot.studio](https://pack-shot.studio)

## What It Does

Upload multiple shots of the same product (taken with different focus points), and PackShot combines them into one perfectly sharp image. Works with 1181+ camera models, no AI required.

### Three Processing Methods

**Aligned Stack (recommended)** — Deterministic, no AI. Uses computer vision to correct camera vibration between shots, then fuses the sharpest parts from each frame.

How it works:
1. **AKAZE feature detection** on each image (binary descriptors, scale/rotation invariant)
2. **BFMatcher** with Hamming distance + Lowe's ratio test for robust matching
3. **findHomography** with RANSAC — estimates perspective transform, rejects outliers
4. **warpPerspective** — aligns each frame to the reference coordinate space
5. **Multi-scale Laplacian focus maps** (kernel sizes 3, 5, 7) — weighted 50/30/20 for fine-to-coarse sharpness
6. **Gaussian-smoothed weighted compositing** — soft blending, no hard seams
7. **Edge fill** from reference image — full-frame output, no black borders

Typical alignment precision: 0.15-0.30px reprojection error. Handles shifts up to 127px between frames.

**Quick Stack** — Client-side, fast. Simple per-pixel Laplacian selection without alignment. Good for tripod shots with zero movement.

**AI Synthesis** — Multi-provider (Gemini, OpenAI, Grok). Generates studio packshots with pure white background. Optional — works with your own API key (BYOK) or purchased credits.

### RAW File Support

Powered by [librawspeed](https://github.com/LibRaw/LibRaw) (LibRaw native addon). Supports:

Canon (CR2, CR3), Nikon (NEF, NRW), Sony (ARW, SRF, SR2), Adobe (DNG), Fujifilm (RAF), Olympus (ORF), Panasonic (RW2, RWL), Pentax (PEF, PTX), Samsung (SRW), Sigma (X3F), Hasselblad (3FR, FFF), Phase One (IIQ), Minolta (MRW), Mamiya (MEF), Leica, Kodak, Epson, and more.

Also reads **PSD/PSB** files (Photoshop) via [ag-psd](https://github.com/nicktaras/ag-psd).

### Export Formats

TIFF (LZW, 300 DPI), JPEG (MozJPEG, quality 95), PNG (lossless), WebP, AVIF, PSD (single layer).

### Post-Processing

Real-time canvas adjustments: gamma (background/object separate), RGB balance, vibrance, sharpen. Interactive crop with drag handles and rule-of-thirds grid.

## Business Model

| | Free | Pro $19/mo | Studio $49/mo |
|---|---|---|---|
| Images/month | 10 | 500 (rollover) | Unlimited (5K soft) |
| Methods | Quick + Aligned | Quick + Aligned | Quick + Aligned |
| AI Synthesis | — | Credits or BYOK | 500 credits included |
| Export formats | JPEG, PNG | All 6 formats | All 6 formats |
| Max resolution | 2048px | 8192px | 8192px |
| Watermark | Yes (removable) | None | None |
| Upload limit | 10 files | 20 files | 50 files |
| API access | — | — | REST API + webhooks |

**Watermark removal:** $1 per image (one-time), or earn free credits through sharing and referrals.

**BYOK (Bring Your Own Key):** Pro/Studio users can plug their own Gemini, OpenAI, or Grok API key — no credit cost.

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS 4, Vite 6, Motion
- **Backend:** Express.js, Node.js 18+
- **Image Processing:** Sharp (libvips), librawspeed (LibRaw), ag-psd
- **Computer Vision:** @techstark/opencv-js (WebAssembly) — AKAZE, BFMatcher, findHomography, warpPerspective
- **AI:** @google/genai (Gemini), openai (GPT-4o/DALL-E), xAI Grok — via adapter pattern
- **Auth:** Supabase (PostgreSQL + Auth + RLS)
- **Billing:** PayPal REST API (subscriptions, orders, revise/change-plan)
- **Invoicing:** iCount (Israeli receipt system) with pending-receipts retry queue
- **Email:** Resend with queue + retry worker (bounded to 3 attempts)
- **CAPTCHA:** Cloudflare Turnstile
- **Security:** helmet CSP (PayPal/Turnstile/Supabase-aware), express-rate-limit behind fly.io proxy, CORS whitelist, file magic validation, webhook idempotency
- **Observability:** pino (structured JSON), Sentry (server + browser, lazy-loaded)
- **Ops:** Past-due subscription cleanup cron, upload directory sweep, DB-aware healthcheck
- **Admin:** Minimal `/#admin` dashboard (stats, user search, grant-credits, override-tier)
- **CI/CD:** GitHub Actions, Docker (multi-stage Alpine), fly.io deployment

## Setup

### Prerequisites

- Node.js 18+
- Supabase project (free tier works)
- PayPal Business account (for billing)
- Cloudflare account (for Turnstile CAPTCHA)

### Install

```bash
git clone https://github.com/YaronGenad/PackShot.git
cd PackShot
npm install
```

### Environment

Copy `.env.example` to `.env` and fill in:

```bash
cp .env.example .env
```

Required for basic operation:
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`
- `APP_URL` (default: `http://localhost:3000`)

Required for billing:
- `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`
- `PAYPAL_PLAN_PRO_MONTHLY`, `PAYPAL_PLAN_PRO_YEARLY`, etc.

Required for AI features:
- `GEMINI_API_KEY` (server-side, never in client bundle)

Required for registration:
- `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY`

### Run

```bash
npm run dev
```

Open http://localhost:3000

### Database

Run migrations in Supabase SQL Editor (Dashboard > SQL Editor), in order:
- `supabase/migrations/001_initial_schema.sql`
- `supabase/migrations/002_webhooks.sql`
- `supabase/migrations/003_email_queue.sql`
- `supabase/migrations/004_rewards_system.sql`
- `supabase/migrations/005_paypal.sql`
- `supabase/migrations/006_atomic_increment.sql`
- `supabase/migrations/007_performance_indexes.sql`
- `supabase/migrations/008_processed_webhooks.sql` — PayPal webhook idempotency
- `supabase/migrations/009_pending_receipts_and_email_retry.sql` — iCount retry queue + email retry counter

### Docker

```bash
docker compose up
```

## Deployment (fly.io)

Primary region: `ams` (Amsterdam, closest to Israel). Config in [fly.toml](fly.toml).

### One-time setup

```bash
# 1. Create persistent volume for /app/uploads
fly volumes create uploads --size 10 --region ams

# 2. Generate BYOK encryption key (save in password manager — NEVER changeable once set)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. Set all runtime secrets (see .env.example for the full list)
fly secrets set \
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... SUPABASE_ANON_KEY=... \
  PAYPAL_CLIENT_ID=... PAYPAL_SECRET=... PAYPAL_MODE=live PAYPAL_WEBHOOK_ID=... \
  PAYPAL_PLAN_PRO_MONTHLY=P-... PAYPAL_PLAN_PRO_YEARLY=P-... \
  PAYPAL_PLAN_STUDIO_MONTHLY=P-... PAYPAL_PLAN_STUDIO_YEARLY=P-... \
  GEMINI_API_KEY=... ICOUNT_API_TOKEN=... BYOK_ENCRYPTION_KEY=<32b hex> \
  TURNSTILE_SECRET_KEY=... RESEND_API_KEY=... SENTRY_DSN=... \
  FROM_EMAIL="PackShot Studio <noreply@pack-shot.studio>" \
  APP_URL=https://pack-shot-studio.fly.dev \
  ALLOWED_ORIGINS=https://pack-shot-studio.fly.dev \
  ADMIN_USER_IDS=<your_user_uuid>
```

### Deploy

Frontend env vars are baked into the JS bundle — pass them as build args on every deploy:

```bash
fly deploy \
  --build-arg VITE_SUPABASE_URL=... \
  --build-arg VITE_SUPABASE_ANON_KEY=... \
  --build-arg VITE_PAYPAL_CLIENT_ID=... \
  --build-arg VITE_TURNSTILE_SITE_KEY=... \
  --build-arg VITE_SENTRY_DSN=...
```

### PayPal webhook

In the PayPal Developer dashboard, point the webhook URL at `https://<your-app>.fly.dev/api/billing/webhook` and subscribe to: `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`, `BILLING.SUBSCRIPTION.UPDATED`, `PAYMENT.SALE.COMPLETED`, `CHECKOUT.ORDER.APPROVED`.

Replayed events are deduped server-side via the `processed_webhooks` table — no risk of double-crediting.

### Optional: Sentry

```bash
npm install @sentry/node @sentry/react
# then set SENTRY_DSN and VITE_SENTRY_DSN
```

Without these packages, the Sentry wrapper is a no-op and the server still starts cleanly.

### Verifying a deploy

```bash
curl https://<app>.fly.dev/api/ping
# Expected: {"status":"ok","db":"ok","timestamp":"..."}
```

The healthcheck queries Supabase before returning 200, so fly.io pulls the VM out of rotation automatically if the DB is unreachable.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for full pipeline diagram, API reference, and file structure.

## Performance

See [RESULTS.md](RESULTS.md) for benchmark data across all 3 methods.

| Method | 4 images (2048px) | Deterministic | Cost |
|--------|-------------------|---------------|------|
| Quick Stack | ~830ms | Yes | $0 |
| Aligned Stack | ~5,600ms | Yes | $0 |
| AI Synthesis | ~5-15s | No | ~$0.05 |

## License

Proprietary. All rights reserved.
