# PackShot Studio — Pre-Launch TODO

The polish sprint closed the critical production gaps: webhook idempotency,
GDPR endpoints, rate-limiting behind fly.io's proxy, DB-aware healthcheck,
email + iCount retry workers, past-due downgrade cron, Sentry wiring, and a
minimal admin dashboard. Remaining work is environment setup + verification.

## Before Deploy (manual setup)

- [ ] Run `supabase/migrations/006_atomic_increment.sql` in Supabase SQL Editor
- [ ] Run `supabase/migrations/007_performance_indexes.sql`
- [ ] Run `supabase/migrations/008_processed_webhooks.sql`
- [ ] Run `supabase/migrations/009_pending_receipts_and_email_retry.sql`
- [ ] Create Resend account, verify `pack-shot.studio` domain, set `RESEND_API_KEY`
- [ ] Create Plausible account, add `pack-shot.studio`
- [ ] Create Sentry account (optional but recommended): `npm install @sentry/node @sentry/react` + set `SENTRY_DSN` + `VITE_SENTRY_DSN`
- [ ] Generate BYOK key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — save in password manager, NEVER change once set
- [ ] Get your user UUID from Supabase → Authentication → Users, set `ADMIN_USER_IDS`
- [ ] `fly volumes create uploads --size 10 --region ams`
- [ ] Set all Fly secrets (see .env.example — all values marked required in validateEnv)
- [ ] First deploy with VITE_ build args:
  ```
  fly deploy \
    --build-arg VITE_SUPABASE_URL=... \
    --build-arg VITE_SUPABASE_ANON_KEY=... \
    --build-arg VITE_PAYPAL_CLIENT_ID=... \
    --build-arg VITE_TURNSTILE_SITE_KEY=... \
    --build-arg VITE_SENTRY_DSN=...
  ```
- [ ] Configure PayPal webhook URL: `https://pack-shot-studio.fly.dev/api/billing/webhook`

## Post-Deploy Verification

- [ ] `curl https://…/api/ping` → `{status:"ok", db:"ok"}`
- [ ] Register → Turnstile → email confirmation → login
- [ ] Free-tier JPEG export with watermark
- [ ] Pro subscription: checkout → webhook → iCount receipt → email
- [ ] Resend the same PayPal event via dev dashboard → second call returns `deduped:true`, no duplicate reward_claim row
- [ ] BYOK flow: add Gemini key → sharpen RAW → no credit deduction
- [ ] `DELETE /api/auth/account` with password → user gone from Supabase, PayPal subscription cancelled
- [ ] `GET /api/auth/export-data` → JSON downloads
- [ ] Visit `/#admin` as an admin user → stats load, grant-credits works
- [ ] 24h fly logs: no ERROR loops, p95 < 2s, memory < 1.5GB

## Growth & Conversion (post-launch)

- [ ] Landing page (currently home = raw app)
- [ ] Onboarding flow — welcome modal + sample RAW images
- [ ] Before/after gallery showcasing AI Sharpening
- [ ] Studio API docs (OpenAPI spec)
- [ ] Comparison pages vs Helicon Focus, Zerene Stacker
- [ ] Hebrew localization for Israeli market
- [ ] Blog for SEO

## Reliability & Operations (future — scale dependent)

- [ ] BullMQ worker queue for image processing (only if Studio tier hits concurrency limit)
- [ ] RAW support in Studio API v1 (Sharp-only today)
- [ ] CDN (Cloudflare) in front of fly.io
- [ ] Admin dashboard charts/cohort analysis
- [ ] Playwright E2E suite
- [ ] Request correlation IDs / distributed tracing

## Completed in Pre-Launch Polish

- ✅ Webhook idempotency (processed_webhooks table + dedupe check)
- ✅ Account deletion + data export endpoints (GDPR)
- ✅ Trust proxy for rate limiter
- ✅ Deep healthcheck with DB connectivity
- ✅ Upload directory sweep (6h stale-file cleanup)
- ✅ Email queue retry worker (3 attempts, 24h window)
- ✅ iCount receipt retry queue + worker
- ✅ Past-due subscription auto-downgrade (7-day grace)
- ✅ PayPal revise (change-plan) endpoint
- ✅ Sentry server + browser (optional via lazy import)
- ✅ Expanded validateEnv — all required PayPal/iCount/Turnstile plan IDs
- ✅ CSP allows PayPal SDK + Turnstile + Supabase realtime
- ✅ Frontend Supabase env hard-check in production builds
- ✅ Dockerfile memory cap aligned with 2GB fly VM
- ✅ Admin middleware + routes + dashboard UI (`/#admin`)
- ✅ Test suites for auth, billing, admin gating
