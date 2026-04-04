# Architecture

## System Overview

RAW PackShot Studio converts camera RAW focus brackets (CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, and 20+ more formats) into sharp product packshots using three independent pipelines: client-side quick stacking, server-side OpenCV-aligned stacking, and optional AI synthesis via Gemini.

## Pipeline

```
RAW File Upload (multipart, max 100MB)
    │
    ▼
┌──────────────────────────────────────────┐
│  POST /api/process-raw                    │
│                                           │
│  Strategy 1: librawspeed thumbnail        │
│    └─ loadBuffer() → createThumbnail-     │
│       JPEGBuffer() (fast, embedded JPEG)  │
│  Strategy 2: librawspeed full decode      │
│    └─ processImage() → createJPEGBuffer() │
│       (full RAW demosaic, slower)         │
│  Strategy 3: Sharp direct (fallback)      │
│    └─ For non-RAW or unsupported files    │
│                                           │
│  Sharp Optimization:                      │
│    rotate() → resize(2048) → jpeg(q=80)   │
└──────────────────────────────────────────┘
    │
    ▼
  Base64 JPEG images sent to frontend
    │
    ▼
┌────────────────┬─────────────────────┬──────────────────┐
│  Quick Stack   │  Aligned Stack      │  AI Synthesis    │
│  (client-side) │  (server-side)      │  (Gemini API)    │
│                │                     │                  │
│  Laplacian     │  POST /api/         │  generatePackshot│
│  variance per  │  focus-stack        │  ()              │
│  pixel         │                     │                  │
│                │  1. Reference       │  Gemini 3.1      │
│  Box blur      │     selection       │  Flash Image     │
│  (radius 3)    │     (max Laplacian  │                  │
│                │      variance)      │  System prompt:  │
│  argmax pixel  │                     │  pure white bg,  │
│  selection     │  2. AKAZE features  │  zero creativity,│
│                │     + BFMatcher     │  exact fidelity  │
│  No alignment  │     + Lowe's ratio  │                  │
│  → ghosting    │                     │  Non-deterministic│
│  possible      │  3. findHomography  │  → varies between│
│                │     (RANSAC, t=3.0) │    runs          │
│                │                     │                  │
│                │  4. warpPerspective  │                  │
│                │     (BORDER_CONSTANT)│                  │
│                │                     │                  │
│                │  5. Multi-scale     │                  │
│                │     focus maps      │                  │
│                │     (ksize 3,5,7)   │                  │
│                │     + Gaussian blur │                  │
│                │                     │                  │
│                │  6. Weighted blend  │                  │
│                │     (soft, no seams)│                  │
│                │                     │                  │
│                │  7. Edge fill from  │                  │
│                │     reference       │                  │
└────────────────┴─────────────────────┴──────────────────┘
    │
    ▼
  Canvas Post-Processing (client-side)
    │
    ├─ Gamma correction (background/object separate, threshold >240)
    ├─ RGB balance (object only)
    ├─ Vibrance (saturation enhancement)
    ├─ Sharpen (unsharp mask convolution)
    └─ Crop (interactive overlay with drag handles)
    │
    ▼
  POST /api/convert-to-tiff
    │
    ├─ Sharp: PNG → TIFF (LZW compression, 300 DPI)
    └─ Browser downloads as attachment
```

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | React 19 + TypeScript | UI components and state |
| Styling | Tailwind CSS 4 | Utility-first CSS |
| Animations | Motion (framer-motion) | UI transitions |
| Build | Vite 6 | Dev server + production build |
| Backend | Express.js 4 | REST API endpoints |
| Image Processing | Sharp 0.34 (libvips) | Decode, resize, JPEG/TIFF encode |
| Computer Vision | @techstark/opencv-js | AKAZE, Homography, warpPerspective |
| AI (optional) | @google/genai | Gemini 3.1 Flash Image API |
| RAW Decoding | librawspeed (LibRaw) | 1181+ cameras, thumbnail + full decode |
| File Upload | Multer | Multipart form handling |

## API Endpoints

| Endpoint | Method | Purpose | Input | Output |
|----------|--------|---------|-------|--------|
| `/api/ping` | GET | Health check | — | `{ status, timestamp }` |
| `/api/process-raw` | POST | RAW → JPEG | Multipart RAW file | `{ images: [{ name, base64, mimeType }] }` |
| `/api/focus-stack` | POST | Aligned stacking | `{ images[], options? }` | `{ result, diagnostics }` |
| `/api/convert-to-tiff` | POST | Export to TIFF | `{ imageBase64 }` | Binary TIFF (attachment) |

## File Structure

```
├── server.ts                           Express server, all API routes
├── src/
│   ├── main.tsx                        React entry point
│   ├── App.tsx                         Root component, routing, state
│   ├── index.css                       Tailwind imports
│   ├── components/
│   │   ├── ApiKeySelector.tsx          API key input modal (skip or enter)
│   │   ├── RawUploader.tsx             RAW file upload with drag-drop
│   │   └── PackshotGenerator.tsx       Main UI: generation, adjustments, crop
│   └── lib/
│       ├── gemini.ts                   Gemini API client (3 functions)
│       ├── focus-stack.ts              OpenCV alignment + stacking engine
│       └── focus-stack-types.ts        TypeScript interfaces
├── benchmark.mjs                       Performance benchmark script
├── RESULTS.md                          Benchmark data and comparison
├── ARCHITECTURE.md                     This file
└── README.md                           Setup and usage guide
```

## Aligned Focus Stack Pipeline Detail

### 1. Reference Selection
Compute global Laplacian variance on each image. The image with the highest variance has the most in-focus area overall and becomes the alignment target.

### 2. Feature Detection (AKAZE)
AKAZE (Accelerated-KAZE) detects keypoints that are invariant to scale and rotation. Binary descriptors allow fast Hamming distance matching. Typical yield: 800-2600 keypoints per 2048x1365 image.

### 3. Feature Matching
BFMatcher with Hamming distance + Lowe's ratio test (threshold 0.75). The ratio test compares the best match distance to the second-best — if they're too similar, the match is ambiguous and rejected. Typical yield: 800-2600 good matches.

### 4. Homography (RANSAC)
`findHomography` with RANSAC (reprojection threshold 3.0px) estimates a 3x3 perspective transform. RANSAC iteratively selects random point subsets, fits a model, and counts inliers. Typical inlier rate: 95-99%.

Validation: reject if determinant of H is outside [0.1, 10] (degenerate transform).

### 5. Warping
`warpPerspective` maps each source image into the reference coordinate space. Black regions outside the original frame get alpha=0, used later for masking.

### 6. Multi-Scale Focus Maps
Three Laplacian kernels (ksize 3, 5, 7) capture fine, medium, and coarse defocus. Weighted 50/30/20. Gaussian blur (sigma=5) smooths the maps to prevent abrupt transitions.

### 7. Weighted Compositing
Focus maps are normalized per-pixel (sum=1.0), then Gaussian-blurred again for soft blending. Each pixel is a weighted average of all aligned images, dominated by whichever image is sharpest at that location.

### 8. Edge Handling
Warped images have black borders. The reference image (never warped) fills these gaps. This preserves full-frame output — edges are typically plain background anyway.

## Graceful Degradation

| Failure | Detection | Recovery |
|---------|-----------|----------|
| <10 features | `keypoints.size() < 10` | Use image unaligned |
| <10 matches | After ratio test | Use image unaligned |
| Bad homography | `abs(det(H))` outside [0.1, 10] | Use image unaligned |
| All alignments fail | No successfully aligned images | Fall back to unaligned stack |
| WASM out of memory | Try/catch on cv operations | Return 500 with message |

Every failure is logged in `diagnostics.alignments[].warning`.
