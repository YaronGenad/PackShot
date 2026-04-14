/**
 * Shared prompt and parser for the AI sharpening analysis step.
 * All three providers (Gemini, OpenAI, Grok) use the same prompt and JSON schema.
 */

import type { SharpenAnalysis } from './types.js';

/** Vision analysis prompt — instructs AI to return JSON pipeline parameters. */
export const SHARPEN_ANALYSIS_PROMPT = `
You are an expert image processing engineer. Analyze this image and return the optimal parameters
for a multi-step algorithmic sharpening pipeline. Your goal is to make the image sharper, cleaner,
and more detailed WITHOUT introducing grain, halos, or over-sharpening artifacts.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "noise_level": "low",
  "blur_level": "none",
  "denoise": { "h": 4, "hColor": 4, "templateWindow": 7, "searchWindow": 21 },
  "deconvolve": { "strength": 0.8, "iterations": 2, "noise_reg": 0.015 },
  "guided": { "radius": 8, "eps": 0.04 },
  "clahe": { "clipLimit": 1.8, "tileGridSize": 8, "apply": true },
  "ringing": { "suppress": true, "threshold": 80 },
  "needs_ai_pass": false,
  "ai_pass_prompt": ""
}

Field rules:
- noise_level: "low" | "medium" | "high" — assess visible grain/noise in the image
- blur_level: "none" | "slight" | "moderate" | "severe" — assess focus softness or camera shake
- denoise.h: 1–15 (higher = more denoising; use ≤4 for low noise, ≤10 for high noise)
- denoise.hColor: same range as h, controls color channel denoising
- deconvolve.strength: 0.3–2.5 (PSF sigma — use ≤0.5 for "none" blur, 1.5–2.5 for "severe")
- deconvolve.iterations: 1–6 (1 for "none" blur, up to 5 for "severe"; more = sharper but riskier)
- deconvolve.noise_reg: 0.005–0.05 (higher = prevents ringing, lower = more aggressive sharpening)
- guided.radius: 4–16 (larger = smoother transitions; 6-8 for sharp subjects, 12-16 for soft)
- guided.eps: 0.01–0.1 (edge sensitivity; lower = more detail preserved)
- clahe.clipLimit: 1.0–4.0 (higher = more local contrast; keep ≤2.5 to avoid unnatural look)
- clahe.apply: false for portraits, skin, already-well-exposed images. true only for dull/flat textures.
- ringing.suppress: true if any sharpening was applied (almost always true)
- ringing.threshold: 50–150 (Canny threshold; lower = more edges detected as ringing zones)
- needs_ai_pass: ALWAYS false. Leave as false regardless of anything else.
- ai_pass_prompt: ALWAYS empty string "".

IMPORTANT: Be conservative. Prefer subtle enhancement over aggressive sharpening.
If the image is already sharp (blur_level "none"), set deconvolve.iterations to 1 and strength to 0.5.
For portraits and people: set noise_level "low", clahe.apply false, denoise.h ≤ 3.
`.trim();

/** Conservative fallback — used when AI returns unparseable JSON. */
export { DEFAULT_SHARPEN_PARAMS } from '../image-enhance.js';

/**
 * Parse AI response text into SharpenAnalysis.
 * Extracts JSON from the response, validates required fields,
 * and falls back to safe defaults if anything is missing or malformed.
 */
export function parseSharpenAnalysis(text: string): SharpenAnalysis {
  // Import fallback locally to avoid circular dep issue
  const fallback: SharpenAnalysis = {
    noise_level: 'low',
    blur_level: 'slight',
    denoise: { h: 4, hColor: 4, templateWindow: 7, searchWindow: 21 },
    deconvolve: { strength: 0.8, iterations: 2, noise_reg: 0.015 },
    guided: { radius: 8, eps: 0.04 },
    clahe: { clipLimit: 1.8, tileGridSize: 8, apply: true },
    ringing: { suppress: true, threshold: 80 },
    needs_ai_pass: false,
    ai_pass_prompt: '',
  };

  try {
    // Strip markdown fences if present (some models add ```json)
    const jsonText = text.replace(/```(?:json)?\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    // Validate and clamp all numeric fields to safe ranges
    return {
      noise_level: ['low', 'medium', 'high'].includes(parsed.noise_level)
        ? parsed.noise_level
        : fallback.noise_level,
      blur_level: ['none', 'slight', 'moderate', 'severe'].includes(parsed.blur_level)
        ? parsed.blur_level
        : fallback.blur_level,
      denoise: {
        h: clamp(parsed.denoise?.h, 1, 15, fallback.denoise.h),
        hColor: clamp(parsed.denoise?.hColor, 1, 15, fallback.denoise.hColor),
        templateWindow: clampOdd(parsed.denoise?.templateWindow, 3, 21, fallback.denoise.templateWindow),
        searchWindow: clampOdd(parsed.denoise?.searchWindow, 11, 41, fallback.denoise.searchWindow),
      },
      deconvolve: {
        strength: clamp(parsed.deconvolve?.strength, 0.3, 2.5, fallback.deconvolve.strength),
        iterations: clamp(parsed.deconvolve?.iterations, 1, 6, fallback.deconvolve.iterations),
        noise_reg: clamp(parsed.deconvolve?.noise_reg, 0.005, 0.1, fallback.deconvolve.noise_reg),
      },
      guided: {
        radius: clamp(parsed.guided?.radius, 2, 16, fallback.guided.radius),
        eps: clamp(parsed.guided?.eps, 0.001, 0.5, fallback.guided.eps),
      },
      clahe: {
        clipLimit: clamp(parsed.clahe?.clipLimit, 1.0, 5.0, fallback.clahe.clipLimit),
        tileGridSize: clamp(parsed.clahe?.tileGridSize, 4, 16, fallback.clahe.tileGridSize),
        apply: typeof parsed.clahe?.apply === 'boolean' ? parsed.clahe.apply : fallback.clahe.apply,
      },
      ringing: {
        suppress: typeof parsed.ringing?.suppress === 'boolean'
          ? parsed.ringing.suppress
          : fallback.ringing.suppress,
        threshold: clamp(parsed.ringing?.threshold, 30, 200, fallback.ringing.threshold),
      },
      // AI final pass is disabled — generative models alter image content entirely,
      // which is destructive for portraits and non-packshot photos.
      needs_ai_pass: false,
      ai_pass_prompt: '',
    };
  } catch {
    return fallback;
  }
}

function clamp(val: any, min: number, max: number, def: number): number {
  const n = Number(val);
  if (!isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function clampOdd(val: any, min: number, max: number, def: number): number {
  const n = clamp(val, min, max, def);
  return n % 2 === 0 ? n + 1 : n; // ensure odd
}
