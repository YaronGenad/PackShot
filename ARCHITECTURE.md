# Architecture

## System Overview

PackShot Studio converts camera RAW focus brackets (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PSD, and 20+ more formats) as well as standard JPG/PNG photos into sharp product packshots. Three processing methods: deterministic focus stacking (Quick/Aligned), and optional multi-provider AI synthesis (Gemini/OpenAI/Grok).

## Pipeline

```
RAW / PSD / JPG / PNG Upload (multipart, max 100MB per file)
    │
    ▼
┌──────────────────────────────────────────────┐
│  POST /api/process-raw                        │
│                                               │
│  Magic-byte validation (anti-spoofing):       │
│    RAW   → TIFF/RIFF/FUJIFILM header check    │
│    PSD   → 8BPS header check                  │
│    JPG   → 0xFF 0xD8 header check             │
│    PNG   → 0x89 0x50 0x4E 0x47 header check   │
│                                               │
│  Branch by extension:                         │
│    PSD         → ag-psd composite → Sharp     │
│    JPG / PNG   → Sharp direct decode (fast)   │
│    RAW         → librawspeed thumbnail        │
│                    └─ fallback: full decode   │
│    Unknown     → Sharp fallback               │
│                                               │
│  All branches converge → 8-bit sRGB JPEG      │
│  + auto-rotate + tier-based resize            │
│  + re-encode JPEG q=80                        │
└──────────────────────────────────────────────┘
    │
    ▼
  Base64 JPEG images sent to frontend
    │
    ▼
┌────────────────┬─────────────────────┬──────────────────┐
│  Quick Stack   │  Aligned Stack      │  AI Synthesis    │
│  (client-side) │  (server-side)      │  (server proxy)  │
│                │                     │                  │
│  Laplacian     │  POST /api/         │  POST /api/      │
│  variance per  │  focus-stack        │  generate-       │
│  pixel         │                     │  packshot        │
│                │  1. AKAZE features  │                  │
│  Box blur      │  2. BFMatcher +     │  Multi-provider: │
│  (radius 3)    │     Lowe's ratio    │  Gemini, OpenAI, │
│                │  3. findHomography   │  Grok (BYOK)    │
│  argmax pixel  │     (RANSAC)        │                  │
│  selection     │  4. warpPerspective  │  System prompt:  │
│                │  5. Multi-scale     │  pure white bg,  │
│  No alignment  │     Laplacian       │  zero creativity │
│  → ghosting    │     (ksize 3,5,7)   │                  │
│  possible      │  6. Gaussian blur   │                  │
│                │  7. Weighted blend  │                  │
│                │  8. Edge fill       │                  │
└────────────────┴─────────────────────┴──────────────────┘
    │
    ▼
  Canvas Post-Processing (client-side)
    ├─ Gamma correction (background/object separate)
    ├─ RGB balance (object only)
    ├─ Vibrance, Sharpen
    ├─ Interactive crop with drag handles
    └─ Watermark (Free tier: diagonal tiled, 80% transparent)
    │
    ▼
  POST /api/export → TIFF / JPEG / PNG / WebP / AVIF / PSD
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript | UI components and state |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Animations | Motion (framer-motion) | UI transitions |
| Build | Vite 6 | Dev server + production build |
| Backend | Express.js 4 | REST API endpoints |
| Image Processing | Sharp 0.34 (libvips) | Decode, resize, JPEG/TIFF/WebP/AVIF encode |
| RAW Decoding | librawspeed (LibRaw) | 1181+ cameras, thumbnail + full decode |
| PSD Read/Write | ag-psd | Photoshop file I/O |
| Computer Vision | @techstark/opencv-js | AKAZE, Homography, warpPerspective (WASM) |
| AI Providers | @google/genai, openai | Multi-provider packshot generation |
| Auth | Supabase Auth | JWT, email confirmation, RLS |
| Database | Supabase (PostgreSQL) | Users, subscriptions, usage, rewards |
| Billing | PayPal REST API | Subscriptions + one-time payments |
| Invoicing | iCount API | Israeli receipt (קבלה) generation |
| CAPTCHA | Cloudflare Turnstile | Registration bot protection |
| Security | helmet, express-rate-limit | Headers, throttling |
| Logging | pino | Structured JSON logging |

## API Endpoints

### Processing
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/process-raw` | Upload RAW/PSD → extract JPEG preview |
| POST | `/api/focus-stack` | Aligned multi-image stacking (OpenCV WASM) |
| POST | `/api/export` | Convert to TIFF/JPEG/PNG/WebP/AVIF/PSD |

### AI (server-proxied, key never in client)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/generate-packshot` | AI studio packshot generation |
| POST | `/api/homogenize` | AI lighting correction |
| POST | `/api/edit-packshot` | AI targeted edit via prompt |
| GET | `/api/ai/providers` | List available AI providers |

### Auth
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | Create account (CAPTCHA required) |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| POST | `/api/auth/refresh` | Refresh access token from refresh cookie |
| POST | `/api/auth/resend-confirmation` | Resend email confirmation link |
| POST | `/api/auth/forgot-password` | Send password reset email |
| POST | `/api/auth/reset-password` | Apply new password via reset token |
| GET | `/api/auth/me` | Current user + usage + subscription |
| GET | `/api/auth/export-data` | GDPR: export all user-scoped records as JSON |
| DELETE | `/api/auth/account` | GDPR: delete account (re-auth, cancels PayPal) |

### Billing (PayPal)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/billing/create-checkout` | Create PayPal subscription |
| POST | `/api/billing/change-plan` | Revise subscription between Pro ↔ Studio |
| POST | `/api/billing/buy-credits` | Purchase AI credit pack |
| POST | `/api/billing/remove-watermark` | One-time watermark removal ($1) |
| POST | `/api/billing/capture-order` | Capture approved PayPal order |
| GET | `/api/billing/popup-return` | PayPal popup return + auto-capture |
| POST | `/api/billing/webhook` | PayPal webhook (signed, idempotent via `processed_webhooks`) |
| POST | `/api/billing/cancel` | Cancel subscription |
| POST | `/api/billing/sync` | Force-sync status from PayPal |
| GET | `/api/billing/status` | Current billing status |
| GET | `/api/billing/portal` | Redirect to PayPal auto-pay management |

### Rewards & Referrals
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/rewards/status` | Watermark credits, AI bonus, referral stats |
| POST | `/api/rewards/claim-share` | Claim share reward (FB/LinkedIn/X) |
| GET | `/api/rewards/referral-link` | Get/create referral link |
| GET | `/api/rewards/active-claims` | List active reward claims |

### Credits & BYOK
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/credits/status` | AI credit balance |
| POST | `/api/credits/ai-key` | Store BYOK key (encrypted) |
| GET | `/api/credits/ai-keys` | List BYOK providers |
| DELETE | `/api/credits/ai-key/:provider` | Remove BYOK key |

### Admin (gated by `ADMIN_USER_IDS`)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/stats` | User counts, tier breakdown, MRR, usage totals |
| GET | `/api/admin/users` | Paginated user list with email search |
| GET | `/api/admin/users/:id` | Full user detail (profile, subs, usage, rewards, referrals) |
| POST | `/api/admin/users/:id/grant-credits` | Support action: grant AI credits |
| POST | `/api/admin/users/:id/override-tier` | Support action: force tier |

### Ops
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ping` | Healthcheck (verifies Supabase connectivity; 503 if DB down) |
| GET | `/api/tier/limits` | Tier definition for the current user |

## File Structure

```
├── server.ts                           Express server: all API routes, trust proxy, CSP, background workers
├── fly.toml                            fly.io deploy config (Amsterdam region, persistent uploads volume)
├── src/
│   ├── main.tsx                        React entry point + AuthProvider + Sentry init
│   ├── App.tsx                         Root component, routing (including `/#admin`), PayPal return handler
│   ├── components/
│   │   ├── AuthModal.tsx               Login/register with Turnstile CAPTCHA
│   │   ├── ErrorBoundary.tsx           Crash recovery UI
│   │   ├── PackshotGenerator.tsx       Main editor: generation, adjustments, crop, export
│   │   ├── RawUploader.tsx             RAW/PSD file upload with validation
│   │   ├── PricingPage.tsx             Tier comparison (Free/Pro/Studio)
│   │   ├── AccountDashboard.tsx        Usage, credits, billing history, subscription
│   │   ├── RewardsPage.tsx             Share-to-earn, referral link, milestone
│   │   ├── UserMenu.tsx                Header dropdown with tier badge
│   │   ├── AICreditsPanel.tsx          AI credit display + purchase
│   │   ├── BYOKSettings.tsx            Manage AI provider keys
│   │   ├── AdminDashboard.tsx          Minimal admin UI (stats, users, support actions)
│   │   └── LegalPages.tsx              Terms, Privacy, Refund
│   └── lib/
│       ├── supabase-client.ts          Frontend Supabase client (hard-checks VITE_ env in prod)
│       ├── auth-context.tsx            React context: user state, billing actions
│       ├── auth/
│       │   ├── middleware.ts           JWT verification, optionalAuth, tier override
│       │   └── routes.ts               Register, login, logout, password reset, GDPR export/delete
│       ├── billing/
│       │   ├── paypal.ts               PayPal REST client (subscriptions, orders, revise, webhook verify)
│       │   ├── routes.ts               Billing routes (checkout, change-plan, webhook idempotency, cancel)
│       │   └── past-due-cleanup.ts     Daily cron: past_due subscriptions > 7d → downgrade to free
│       ├── invoicing/
│       │   └── icount.ts               Israeli receipt (קבלה) + pending_receipts retry queue
│       ├── credits/
│       │   ├── ai-credits.ts           AI credit tracking + BYOK provider resolution
│       │   ├── byok.ts                 AES-256 encryption for user API keys
│       │   └── routes.ts               Credit status + BYOK endpoints
│       ├── rewards/
│       │   ├── rewards.ts              Reward ledger: grant, consume, query
│       │   └── routes.ts               Share claims, referral links, status
│       ├── tier/
│       │   ├── limits.ts               Tier definitions, quota middleware, format gating
│       │   └── watermark.ts            Diagonal tiled watermark generation
│       ├── ai-providers/
│       │   ├── types.ts                AIProvider adapter interface
│       │   ├── gemini.ts               Google Gemini adapter
│       │   ├── openai.ts               OpenAI GPT-4o adapter
│       │   ├── grok.ts                 xAI Grok adapter
│       │   ├── sharpen-prompt.ts       Unified vision-analysis prompt + JSON clamping
│       │   └── registry.ts             Provider factory + selection logic
│       ├── studio-api/
│       │   ├── api-auth.ts             API key authentication middleware
│       │   ├── api-keys.ts             Generate/list/revoke API keys
│       │   ├── v1-routes.ts            REST API v1 endpoints
│       │   └── webhooks.ts             Webhook management + delivery
│       ├── admin/
│       │   ├── middleware.ts           ADMIN_USER_IDS whitelist gating
│       │   └── routes.ts               Stats, users, grant-credits, override-tier
│       ├── email/
│       │   ├── notifications.ts        Email queue (welcome, subscription, usage)
│       │   └── retry-worker.ts         Every 5 min: retry failed emails (bounded to 3 attempts)
│       ├── observability/
│       │   ├── sentry.ts               Server Sentry wrapper (lazy-loaded, optional peer)
│       │   └── sentry-client.ts        Browser Sentry wrapper (lazy-loaded)
│       ├── db/
│       │   └── supabase.ts             Supabase admin client + DB helpers
│       ├── image-enhance.ts            Denoise + deconvolve + CLAHE sharpening pipeline
│       ├── focus-stack.ts              OpenCV alignment + compositing engine
│       └── focus-stack-types.ts        TypeScript types for focus stacking
├── supabase/
│   └── migrations/                     Database schema (9 migrations: core + rewards + PayPal + idempotency + retry)
├── tests/
│   ├── api.test.ts                     Export/focus-stack/process-raw integration tests
│   ├── auth.test.ts                    Auth validation + gating (register, login, forgot-password, account)
│   └── billing.test.ts                 Billing auth gating + webhook idempotency + admin gating
├── Dockerfile                          Multi-stage Alpine; NODE_OPTIONS=--max-old-space-size=1536 for 2GB fly VM
├── docker-compose.yml                  Dev/prod service config
├── .github/workflows/ci.yml            Build + test on push/PR
└── RESULTS.md                          Performance benchmarks
```

## Security

- **Helmet CSP** — Strict in production with explicit allowlists for PayPal SDK (`paypal.com`, `paypalobjects.com`), Cloudflare Turnstile (`challenges.cloudflare.com`), and Supabase realtime (`wss://<project>.supabase.co`). Relaxed in dev for Vite HMR.
- **Rate limiting behind proxy** — API: 100/15min, Upload: 20/15min, Processing: 10/min, Registration: 10/hour. `app.set('trust proxy', 1)` in production so limits key off the real client IP, not fly.io's edge.
- **CORS** — Explicit origin whitelist via `ALLOWED_ORIGINS` env (required in production by `validateEnv`).
- **CAPTCHA** — Cloudflare Turnstile on registration.
- **File validation** — Magic byte checks prevent extension spoofing on RAW/PSD/JPEG/PNG uploads.
- **Webhook idempotency** — PayPal events deduped via `processed_webhooks` table (event_id PK). Replays never double-process.
- **GDPR** — `DELETE /api/auth/account` requires password re-auth, cancels active PayPal subscriptions, cascades DB via FK. `GET /api/auth/export-data` returns full user-scoped JSON.
- **API keys** — Server-side only, never in client bundle. BYOK keys encrypted at rest.
- **BYOK encryption** — AES-256-CBC with random IVs. `BYOK_ENCRYPTION_KEY` is immutable once the first user stores a key — rotating it makes all stored keys unreadable.
- **RLS** — Row-level security on all Supabase tables; service role bypass on the server.
- **JWT cookies** — HttpOnly, Secure, SameSite=Lax, 7-day lifetime with 30-day refresh cookie.
- **Admin gating** — `/api/admin/*` requires authenticated user whose ID is in `ADMIN_USER_IDS`.

## Reliability & Operations

### Background workers (server.ts)

All workers `.unref()` their timers so they never block graceful shutdown.

| Job | Cadence | Purpose |
|-----|---------|---------|
| Upload sweep | Startup + hourly | Remove files in `/app/uploads` older than 6h (orphans from crashed requests) |
| Email retry | Every 5 min | Retry `email_queue` rows with `status='failed'` and `retry_count < 3` (24h window) |
| iCount receipt retry | Every 5 min | Retry `pending_receipts` rows up to 5 attempts |
| Past-due cleanup | Daily (10 min after startup) | Mark `past_due` subscriptions older than 7d as cancelled, downgrade user to free, email them |

### Healthcheck

`GET /api/ping` runs `SELECT id FROM profiles LIMIT 1`. Returns 503 `{status:"unavailable",db:"down"}` if Supabase is unreachable — fly.io's `[http_service]` checker removes the VM from rotation automatically.

### Error monitoring

Sentry wrapper in `src/lib/observability/sentry.ts` lazy-imports `@sentry/node` so the peer package is optional. Without installation or DSN, init is a no-op and the server starts cleanly. Request + error middleware are wired in `server.ts` only if initialization succeeded.

### Memory budget (2GB fly VM)

- `NODE_OPTIONS=--max-old-space-size=1536` in Dockerfile — leaves ~500MB headroom for Sharp/OpenCV native memory.
- `sharp.cache(false)` + `sharp.concurrency(1)` — serialize image ops so large RAW decodes never pile up.
- Fly autoscaling caps: soft 20, hard 25 concurrent connections per VM.

### Deployment flow (fly.io)

1. `validateEnv()` on startup fails fast if any required env var is missing (all `PAYPAL_PLAN_*`, `BYOK_ENCRYPTION_KEY`, etc.).
2. Frontend `VITE_*` vars are baked into the bundle at build time via Dockerfile `ARG`s. `supabase-client.ts` hard-throws in production if they're empty.
3. Graceful shutdown: `SIGTERM` drains Express connections (10s max) before `process.exit(0)`.
