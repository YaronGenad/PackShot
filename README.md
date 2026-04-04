# RAW Packshot Studio Synthesizer

Professional tool for converting camera RAW focus brackets into sharp, studio-quality product packshots. Supports 1181+ camera models (Canon, Nikon, Sony, Fujifilm, Panasonic, Leica, and more).

## Supported RAW Formats

CR2, CR3, NEF, ARW, DNG, RAF, ORF, RW2, PEF, SRW, X3F, 3FR, IIQ, MRW, MEF, KDC, DCR, ERF, and more — powered by librawspeed (LibRaw).

## Features

### Aligned Focus Stacking (Deterministic, No LLM)
- **OpenCV-based image alignment** — AKAZE feature detection + Homography (RANSAC) corrects camera vibration between shots
- **Multi-scale focus maps** — Laplacian at 3 scales (fine/medium/coarse) with Gaussian smoothing
- **Weighted soft blending** — Smooth transitions between focus zones, no hard seams or ghosting
- **Edge handling** — Fills warped borders from reference image for full-frame output
- Runs server-side via `@techstark/opencv-js` (WASM), no external API calls

### AI Synthesis (Optional, requires Gemini API key)
- Gemini 3.1 Flash Image generates studio packshots with pure white background
- Homogenization — balances overexposed highlights and underexposed shadows
- Targeted AI editing via free-form prompts

### Quick Stack (Client-side)
- Fast client-side Laplacian variance stacking without alignment
- No server round-trip, but may show ghosting with camera movement

### Post-Processing
- Gamma control (separate background/object)
- RGB balance, vibrance, sharpen
- Interactive crop tool
- Export to TIFF (LZW compressed, 300 DPI)

## Run Locally

**Prerequisites:** Node.js 18+

1. Install dependencies:
   ```
   npm install
   ```

2. Run the app:
   ```
   npm run dev
   ```

3. Open http://localhost:3000

On startup you can either enter a Gemini API key (for AI features) or skip to use focus stacking only.

## Usage

1. Upload RAW files (multiple shots of the same product with different focus points)
2. Choose a generation method:
   - **AI Synthesis** — Gemini-powered studio packshot (requires API key)
   - **Aligned Stack** — Deterministic OpenCV alignment + multi-scale focus stacking
   - **Quick Stack** — Fast client-side stacking without alignment
3. Adjust the result (gamma, RGB, vibrance, sharpen)
4. Crop edges if needed
5. Download as TIFF

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS, Vite
- **Backend:** Express.js, Sharp (image processing)
- **RAW Decoding:** librawspeed (LibRaw native addon, 1181+ cameras)
- **Alignment:** @techstark/opencv-js (WASM) — AKAZE, BFMatcher, findHomography, warpPerspective
- **AI (optional):** Google Gemini 3.1 Flash Image via @google/genai

## Architecture

```
RAW Upload → /api/process-raw → librawspeed extraction → Sharp optimization
                                                                ↓
                                                      Processed base64 images
                                                                ↓
                                          ┌─────────────────────┼──────────────────────┐
                                          ↓                     ↓                      ↓
                                AI Synthesis          Aligned Stack              Quick Stack
                                (Gemini API)      /api/focus-stack             (client-side)
                                              OpenCV alignment +
                                              multi-scale focus +
                                              weighted compositing
                                          └─────────────────────┼──────────────────────┘
                                                                ↓
                                                      Canvas adjustments
                                                 (gamma, RGB, vibrance, sharpen, crop)
                                                                ↓
                                                      /api/convert-to-tiff
                                                           Download
```
