# PackShot Studio — Remaining Work

## Manual Setup (Before Deploy)
- [ ] Run `supabase/migrations/006_atomic_increment.sql` in Supabase SQL Editor
- [ ] Create Resend account, verify domain, set `RESEND_API_KEY` in `.env`
- [ ] Create Plausible account, add `pack-shot.studio` domain
- [ ] Install Sentry: `npm install @sentry/node @sentry/react`, wire into server.ts + ErrorBoundary
- [ ] Add GitHub Secrets: `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_WEBHOOK_ID`
- [ ] Create `fly.toml` for Fly.io deployment

## Track C — Post-Launch Sprint (weeks 1-2)
- [ ] Landing page with hero, before/after demos, social proof, CTA
- [ ] Onboarding flow — welcome modal + sample RAW images for first-time users
- [ ] Studio API documentation (OpenAPI spec or docs page)
- [ ] Webhook idempotency — `processed_webhooks` table, deduplicate by `event.id`
- [ ] Subscription upgrade/downgrade between Pro and Studio (PayPal revision API)
- [ ] Past_due subscription cleanup cron (downgrade after 7 days)
- [ ] Account deletion endpoint (`DELETE /api/auth/account`) for GDPR
- [ ] iCount receipt error handling — log errors, queue for retry instead of silent `.catch(() => {})`
- [ ] Upload directory cleanup cron (temp files from failed processing)
- [ ] Worker queue for image processing (BullMQ) — currently single-threaded

## Nice-to-Have
- Progress indicator during focus stacking
- Image history / gallery
- Admin dashboard for revenue/user metrics
- Blog for content marketing
- Comparison pages (vs Helicon Focus, Zerene Stacker)
- RAW support in Studio API v1
- CDN for static assets (Cloudflare in front of Fly.io)
- E2E tests (Playwright)
- Unit tests for billing/credits/rewards logic
- Hebrew localization
