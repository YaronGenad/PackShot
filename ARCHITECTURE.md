# Architecture

## System Overview

PackShot Studio converts camera RAW focus brackets (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PSD, and 20+ more formats) into sharp product packshots. Three processing methods: deterministic focus stacking (Quick/Aligned), and optional multi-provider AI synthesis (Gemini/OpenAI/Grok).

## Pipeline

```
RAW/PSD File Upload (multipart, max 100MB)
    │
    ▼
┌──────────────────────────────────────────┐
│  POST /api/process-raw                    │
│                                           │
│  Strategy 1: librawspeed thumbnail        │
│    └─ loadBuffer() → embedded JPEG (fast) │
│  Strategy 2: librawspeed full decode      │
│    └─ processImage() → JPEG (full RAW)    │
│  Strategy 3: ag-psd (PSD files)           │
│    └─ readPsd() → composite/layer RGBA    │
│  Strategy 4: Sharp direct (fallback)      │
│                                           │
│  + Magic byte validation (anti-spoofing)  │
│  + Sharp optimization (rotate, 2048px)    │
└──────────────────────────────────────────┘
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
| GET | `/api/auth/me` | Current user + usage + subscription |

### Billing (PayPal)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/billing/create-checkout` | Create PayPal subscription |
| POST | `/api/billing/buy-credits` | Purchase AI credit pack |
| POST | `/api/billing/remove-watermark` | One-time watermark removal ($1) |
| POST | `/api/billing/capture-order` | Capture approved PayPal order |
| GET | `/api/billing/popup-return` | PayPal popup return + auto-capture |
| POST | `/api/billing/webhook` | PayPal webhook handler |
| POST | `/api/billing/cancel` | Cancel subscription |
| GET | `/api/billing/status` | Current billing status |

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

## File Structure

```
├── server.ts                           Express server, all API routes
├── src/
│   ├── main.tsx                        React entry point + AuthProvider
│   ├── App.tsx                         Root component, routing, PayPal return handler
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
│   │   └── LegalPages.tsx              Terms, Privacy, Refund
│   └── lib/
│       ├── auth-context.tsx            React context: user state, billing actions
│       ├── auth/
│       │   ├── middleware.ts           JWT verification, optionalAuth, tier override
│       │   └── routes.ts              Register, login, logout, email confirmation
│       ├── billing/
│       │   ├── paypal.ts              PayPal REST client (subscriptions, orders)
│       │   └── routes.ts             Billing routes (checkout, webhook, cancel)
│       ├── invoicing/
│       │   └── icount.ts             Israeli receipt generation (קבלה)
│       ├── credits/
│       │   ├── ai-credits.ts         AI credit tracking + BYOK provider resolution
│       │   ├── byok.ts               AES-256 encryption for user API keys
│       │   └── routes.ts             Credit status + BYOK endpoints
│       ├── rewards/
│       │   ├── rewards.ts            Reward ledger: grant, consume, query
│       │   └── routes.ts             Share claims, referral links, status
│       ├── tier/
│       │   ├── limits.ts             Tier definitions, quota middleware, format gating
│       │   └── watermark.ts          Diagonal tiled watermark generation
│       ├── ai-providers/
│       │   ├── types.ts              AIProvider adapter interface
│       │   ├── gemini.ts             Google Gemini adapter
│       │   ├── openai.ts             OpenAI GPT-4o adapter
│       │   ├── grok.ts               xAI Grok adapter
│       │   └── registry.ts           Provider factory + selection logic
│       ├── studio-api/
│       │   ├── api-auth.ts           API key authentication middleware
│       │   ├── api-keys.ts           Generate/list/revoke API keys
│       │   ├── v1-routes.ts          REST API v1 endpoints
│       │   └── webhooks.ts           Webhook management + delivery
│       ├── email/
│       │   └── notifications.ts      Email queue (welcome, subscription, usage)
│       ├── db/
│       │   └── supabase.ts           Supabase client + DB helpers
│       ├── focus-stack.ts            OpenCV alignment + compositing engine
│       └── focus-stack-types.ts      TypeScript types for focus stacking
├── supabase/
│   └── migrations/                   Database schema (5 migrations)
├── tests/
│   └── api.test.ts                   Integration tests (19 tests)
├── Dockerfile                        Multi-stage Alpine production build
├── docker-compose.yml                Dev/prod service config
├── .github/workflows/ci.yml          Build + test on push/PR
└── RESULTS.md                        Performance benchmarks
```

## Security

- **Helmet** — HSTS, X-Frame-Options, CSP (strict in production, relaxed in dev for Vite HMR)
- **Rate limiting** — API: 100/15min, Upload: 20/15min, Processing: 10/min
- **CORS** — Explicit origin whitelist in production
- **CAPTCHA** — Cloudflare Turnstile on registration
- **File validation** — Magic byte checks prevent extension spoofing
- **API keys** — Server-side only, never in client bundle
- **BYOK encryption** — AES-256-CBC with random IVs
- **RLS** — Row-level security on all Supabase tables
- **JWT cookies** — HttpOnly, Secure, SameSite=Lax
