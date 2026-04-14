/**
 * AI-guided image enhancement pipeline.
 *
 * Chain: Denoise → Blind Deconvolution → Guided Filter → CLAHE → Ringing Suppression
 *
 * Parameters are determined by AI analysis of the input image, then passed here.
 * The AI step runs before this module and determines the optimal per-image parameters.
 * An optional AI final-pass can be requested when the pipeline might introduce artifacts.
 */

// @ts-ignore — same import style as focus-stack.ts
import cv from '@techstark/opencv-js';
import sharp from 'sharp';
import pino from 'pino';

const log = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

// ── OpenCV initialization (same singleton as focus-stack.ts) ──────────────

let cvReady: Promise<void> | null = null;

function ensureCV(): Promise<void> {
  if (!cvReady) {
    cvReady = new Promise<void>((resolve) => {
      if ((cv as any).getBuildInformation) {
        resolve();
      } else {
        (cv as any).onRuntimeInitialized = () => resolve();
      }
    });
  }
  return cvReady;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SharpenParams {
  noise_level: 'low' | 'medium' | 'high';
  blur_level: 'none' | 'slight' | 'moderate' | 'severe';
  denoise: { h: number; hColor: number; templateWindow: number; searchWindow: number };
  deconvolve: { strength: number; iterations: number; noise_reg: number };
  guided: { radius: number; eps: number };
  clahe: { clipLimit: number; tileGridSize: number; apply: boolean };
  ringing: { suppress: boolean; threshold: number };
  needs_ai_pass: boolean;
  ai_pass_prompt: string;
}

/** Conservative defaults — used when AI analysis fails or returns invalid JSON. */
export const DEFAULT_SHARPEN_PARAMS: SharpenParams = {
  noise_level: 'low',
  blur_level: 'none',
  denoise: { h: 3, hColor: 3, templateWindow: 7, searchWindow: 21 },
  deconvolve: { strength: 0.6, iterations: 1, noise_reg: 0.025 },
  guided: { radius: 6, eps: 0.05 },
  clahe: { clipLimit: 1.4, tileGridSize: 8, apply: false },
  ringing: { suppress: true, threshold: 100 },
  needs_ai_pass: false,
  ai_pass_prompt: '',
};

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Run the full enhancement pipeline on a base64 image.
 * Returns a data URL with the enhanced result.
 */
export async function sharpenImage(
  base64: string,
  _mimeType: string,
  params: SharpenParams,
): Promise<string> {
  await ensureCV();

  const t0 = Date.now();

  // Decode to raw RGBA pixels via Sharp (max 2048px — same limit as rest of pipeline)
  const inputBuf = Buffer.from(base64, 'base64');
  const { data: rawPixels, info } = await sharp(inputBuf)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Load as RGBA cv.Mat (Sharp outputs RGBA)
  const matRGBA = new cv.Mat(height, width, cv.CV_8UC4);
  matRGBA.data.set(rawPixels);

  // RGBA → BGR for OpenCV processing
  const matBGR = new cv.Mat();
  cv.cvtColor(matRGBA, matBGR, cv.COLOR_RGBA2BGR);
  matRGBA.delete();

  let current: any = matBGR;

  try {
    // ── Step 1: Denoise — skip for low-noise images to avoid plastic/soft skin ─
    if (params.noise_level !== 'low') {
      log.debug({ h: params.denoise.h, level: params.noise_level }, 'enhance: denoise');
      current = applyDenoise(current, params.denoise);
    } else {
      log.debug('enhance: denoise skipped (noise_level=low)');
    }

    // ── Step 2: Blind Deconvolution (iterative unsharp, Wiener-style) ─────
    if (params.blur_level !== 'none' && params.deconvolve.iterations > 0) {
      log.debug(
        { sigma: params.deconvolve.strength, iters: params.deconvolve.iterations },
        'enhance: deconvolution',
      );
      current = applyIterativeDeconvolution(current, params.deconvolve);
    }

    // ── Step 3: Guided Filter — edge-preserving detail enhancement ────────
    log.debug({ r: params.guided.radius, eps: params.guided.eps }, 'enhance: guided filter');
    current = applyGuidedFilterEnhancement(current, params.guided);

    // ── Step 4: CLAHE — local contrast (L channel in LAB only) ────────────
    if (params.clahe.apply) {
      log.debug({ clipLimit: params.clahe.clipLimit }, 'enhance: CLAHE');
      current = applyCLAHE(current, params.clahe);
    }

    // ── Step 5: Ringing Suppression ───────────────────────────────────────
    if (params.ringing.suppress) {
      log.debug({ threshold: params.ringing.threshold }, 'enhance: ringing suppression');
      current = applyRingingSuppression(current, params.ringing);
    }

    // BGR → RGBA for Sharp (same encoding as focus-stack.ts)
    const matRGBAOut = new cv.Mat();
    cv.cvtColor(current, matRGBAOut, cv.COLOR_BGR2RGBA);
    current.delete();
    current = null;

    const resultBuf = Buffer.from(matRGBAOut.data);
    matRGBAOut.delete();

    const jpegBuf = await sharp(resultBuf, { raw: { width, height, channels: 4 } })
      .removeAlpha()
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();

    log.info({ ms: Date.now() - t0, width, height }, 'enhance: pipeline complete');

    return `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
  } catch (err) {
    if (current) current.delete();
    throw err;
  }
}

// ── Step 1: NL-Means Denoising ────────────────────────────────────────────

function applyDenoise(src: any, params: SharpenParams['denoise']): any {
  const h = Math.max(1, Math.min(20, params.h));
  const hColor = Math.max(1, Math.min(20, params.hColor));
  // templateWindow and searchWindow must be odd
  const tw = Math.max(3, Math.min(21, params.templateWindow)) | 1;
  const sw = Math.max(11, Math.min(41, params.searchWindow)) | 1;

  const dst = new cv.Mat();

  try {
    // Primary: NL-Means (Non-Local Means) — best quality, preserves fine detail
    if (typeof (cv as any).fastNlMeansDenoisingColored === 'function') {
      (cv as any).fastNlMeansDenoisingColored(src, dst, h, hColor, tw, sw);
      src.delete();
      return dst;
    }
  } catch {
    // Fall through to bilateral fallback
  }

  // Fallback: Bilateral filter — edge-preserving, less accurate than NL-Means
  // sigma values derived from h parameter to maintain comparable noise suppression
  log.debug('enhance: NL-Means unavailable, using bilateral filter');
  cv.bilateralFilter(src, dst, 9, h * 8, h * 4);
  src.delete();
  return dst;
}

// ── Step 2: Blind Deconvolution (iterative unsharp approximation) ─────────
//
// True blind deconvolution estimates both the image and the PSF simultaneously.
// Here we approximate via multi-iteration adaptive unsharp mask:
//   Each iteration: extract blur-estimated detail = (current - GaussianBlur(current, σ))
//                   then: current += detail * step
// σ is AI-determined from blur_level, step is controlled by noise_reg to
// prevent overshooting. This converges toward the deblurred image.

function applyIterativeDeconvolution(src: any, params: SharpenParams['deconvolve']): any {
  const sigma = Math.max(0.3, Math.min(3.0, params.strength));
  const iterations = Math.max(1, Math.min(8, params.iterations));
  // Step size: smaller noise_reg → larger step (more aggressive sharpening)
  // Capped at 0.35 per iteration to prevent ringing
  const step = Math.min(0.35, 0.5 / (params.noise_reg * 50 + 1));

  const ksize = (Math.max(3, Math.round(sigma * 4)) | 1); // odd kernel size

  let current = src.clone();
  src.delete();

  for (let i = 0; i < iterations; i++) {
    const blurred = new cv.Mat();
    cv.GaussianBlur(current, blurred, new cv.Size(ksize, ksize), sigma, sigma);

    // detail = current - blurred (high-frequency content = blur kernel residual)
    const detail = new cv.Mat();
    cv.addWeighted(current, 1.0, blurred, -1.0, 0, detail);
    blurred.delete();

    // sharpened = current + detail * step
    const sharpened = new cv.Mat();
    cv.addWeighted(current, 1.0, detail, step, 0, sharpened);
    detail.delete();
    current.delete();

    // convertTo CV_8U applies saturate_cast — clips to [0, 255]
    current = new cv.Mat();
    sharpened.convertTo(current, cv.CV_8U);
    sharpened.delete();
  }

  return current;
}

// ── Step 3: Guided Filter — edge-preserving detail enhancement ───────────
//
// Guided filter output q(x) = a(x)*I(x) + b(x) where a, b are locally linear
// coefficients computed from the guidance image I and input p.
// Here we use self-guided (I = grayscale of src, p = each BGR channel).
//
// Enhancement: output = src + (src - guided_smooth(src)) * gain
// This amplifies high-frequency detail while preserving edges (no halo).

function applyGuidedFilterEnhancement(src: any, params: SharpenParams['guided']): any {
  const r = Math.max(2, Math.min(16, Math.round(params.radius)));
  const eps = Math.max(0.001, Math.min(0.5, params.eps));
  const gain = 0.35; // detail amplification — subtle, avoids HDR / over-crunchy artefacts
  const ksize = new cv.Size(2 * r + 1, 2 * r + 1);

  // Convert src to float [0, 1]
  const srcF = new cv.Mat();
  src.convertTo(srcF, cv.CV_32F, 1.0 / 255.0);

  // Guidance = grayscale (same as src, self-guided)
  const guideGray = new cv.Mat();
  cv.cvtColor(src, guideGray, cv.COLOR_BGR2GRAY);
  const guideF = new cv.Mat();
  guideGray.convertTo(guideF, cv.CV_32F, 1.0 / 255.0);
  guideGray.delete();

  // mean_I, var_I for guidance
  const meanI = new cv.Mat();
  cv.boxFilter(guideF, meanI, cv.CV_32F, ksize);

  const II = new cv.Mat();
  cv.multiply(guideF, guideF, II);
  const meanII = new cv.Mat();
  cv.boxFilter(II, meanII, cv.CV_32F, ksize);
  II.delete();

  const meanI2 = new cv.Mat();
  cv.multiply(meanI, meanI, meanI2);
  const varI = new cv.Mat();
  cv.subtract(meanII, meanI2, varI);
  meanII.delete();
  meanI2.delete();

  // Process each of the 3 BGR channels
  const srcChannels = new cv.MatVector();
  cv.split(srcF, srcChannels);

  const smoothChannels = new cv.MatVector();

  for (let c = 0; c < 3; c++) {
    const p = srcChannels.get(c);

    const meanP = new cv.Mat();
    cv.boxFilter(p, meanP, cv.CV_32F, ksize);

    const Ip = new cv.Mat();
    cv.multiply(guideF, p, Ip);
    const meanIp = new cv.Mat();
    cv.boxFilter(Ip, meanIp, cv.CV_32F, ksize);
    Ip.delete();

    // cov_Ip = mean(I*p) - mean(I)*mean(p)
    const meanIxmeanP = new cv.Mat();
    cv.multiply(meanI, meanP, meanIxmeanP);
    const covIp = new cv.Mat();
    cv.subtract(meanIp, meanIxmeanP, covIp);
    meanIp.delete();
    meanIxmeanP.delete();

    // a = cov_Ip / (var_I + eps)
    const epsScalar = new cv.Mat(varI.rows, varI.cols, cv.CV_32F, new cv.Scalar(eps));
    const varIReg = new cv.Mat();
    cv.add(varI, epsScalar, varIReg);
    epsScalar.delete();
    const a = new cv.Mat();
    cv.divide(covIp, varIReg, a);
    covIp.delete();
    varIReg.delete();

    // b = mean_p - a * mean_I
    const axMeanI = new cv.Mat();
    cv.multiply(a, meanI, axMeanI);
    const b = new cv.Mat();
    cv.subtract(meanP, axMeanI, b);
    meanP.delete();
    axMeanI.delete();

    // Smooth a and b (local averages)
    const meanA = new cv.Mat();
    cv.boxFilter(a, meanA, cv.CV_32F, ksize);
    const meanB = new cv.Mat();
    cv.boxFilter(b, meanB, cv.CV_32F, ksize);
    a.delete();
    b.delete();

    // q = mean_a * I + mean_b  (guided-smooth output)
    const meanAxI = new cv.Mat();
    cv.multiply(meanA, guideF, meanAxI);
    const q = new cv.Mat();
    cv.add(meanAxI, meanB, q);
    meanA.delete();
    meanB.delete();
    meanAxI.delete();

    smoothChannels.push_back(q);
    p.delete();
  }

  srcChannels.delete();

  // Merge guided-smooth channels
  const smoothF = new cv.Mat();
  cv.merge(smoothChannels, smoothF);
  for (let c = 0; c < 3; c++) smoothChannels.get(c).delete();
  smoothChannels.delete();

  guideF.delete();
  meanI.delete();
  varI.delete();

  // enhancement = src + (src - smooth) * gain
  const detail = new cv.Mat();
  cv.subtract(srcF, smoothF, detail);
  smoothF.delete();

  const enhanced = new cv.Mat();
  cv.addWeighted(srcF, 1.0, detail, gain, 0, enhanced);
  detail.delete();
  srcF.delete();

  // convertTo CV_8U: values are scaled by 255 and saturated to [0, 255]
  const dst = new cv.Mat();
  enhanced.convertTo(dst, cv.CV_8U, 255.0);
  enhanced.delete();
  src.delete();

  return dst;
}

// ── Step 4: CLAHE — Contrast Limited Adaptive Histogram Equalization ──────
//
// Applied ONLY on the L (luminance) channel in LAB color space.
// This enhances local contrast and reveals texture detail without
// affecting hue or saturation.

function applyCLAHE(src: any, params: SharpenParams['clahe']): any {
  const clipLimit = Math.max(1.0, Math.min(6.0, params.clipLimit));
  const tileSize = Math.max(4, Math.min(16, params.tileGridSize));

  // BGR → LAB
  const lab = new cv.Mat();
  cv.cvtColor(src, lab, cv.COLOR_BGR2Lab);

  const channels = new cv.MatVector();
  cv.split(lab, channels);
  lab.delete();

  const L = channels.get(0);
  const a = channels.get(1);
  const b = channels.get(2);

  let L_enhanced = new cv.Mat();

  try {
    const clahe = cv.createCLAHE(clipLimit, new cv.Size(tileSize, tileSize));
    clahe.apply(L, L_enhanced);
    if (typeof clahe.delete === 'function') clahe.delete();
  } catch {
    // Fallback: regular histogram equalization on L channel
    log.debug('enhance: createCLAHE unavailable, using equalizeHist');
    cv.equalizeHist(L, L_enhanced);
  }

  L.delete();

  const outChannels = new cv.MatVector();
  outChannels.push_back(L_enhanced);
  outChannels.push_back(a);
  outChannels.push_back(b);

  const labOut = new cv.Mat();
  cv.merge(outChannels, labOut);
  L_enhanced.delete();
  a.delete();
  b.delete();
  outChannels.delete();
  channels.delete();

  const dst = new cv.Mat();
  cv.cvtColor(labOut, dst, cv.COLOR_Lab2BGR);
  labOut.delete();
  src.delete();

  return dst;
}

// ── Step 5: Ringing Suppression ───────────────────────────────────────────
//
// After sharpening, high-contrast edges can develop "ringing" — oscillating
// brightness halos. We detect edge regions (Canny → dilate) and gently
// blend those zones with a slightly blurred version to damp the oscillation.
// Non-edge regions are untouched.

function applyRingingSuppression(src: any, params: SharpenParams['ringing']): any {
  const threshold = Math.max(30, Math.min(200, params.threshold));

  // Edge detection
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, threshold * 0.4, threshold);
  gray.delete();

  // Dilate to cover the ringing zone (2–3px around each edge)
  const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
  const dilatedEdges = new cv.Mat();
  cv.dilate(edges, dilatedEdges, kernel);
  kernel.delete();
  edges.delete();

  // Convert edge mask to 3-channel float [0, 1]
  const edgeMask1ch = new cv.Mat();
  dilatedEdges.convertTo(edgeMask1ch, cv.CV_32F, 1.0 / 255.0);
  dilatedEdges.delete();

  const maskChannels = new cv.MatVector();
  maskChannels.push_back(edgeMask1ch);
  maskChannels.push_back(edgeMask1ch.clone());
  maskChannels.push_back(edgeMask1ch.clone());
  const edgeMask3ch = new cv.Mat();
  cv.merge(maskChannels, edgeMask3ch);
  edgeMask1ch.delete();
  // cleanup clones held by MatVector
  maskChannels.get(1).delete();
  maskChannels.get(2).delete();
  maskChannels.delete();

  // Gentle blur of the processed image (to mix into edge zones)
  const blurred = new cv.Mat();
  cv.GaussianBlur(src, blurred, new cv.Size(3, 3), 0.8);

  // Float conversion
  const srcF = new cv.Mat();
  src.convertTo(srcF, cv.CV_32F, 1.0 / 255.0);
  const blurF = new cv.Mat();
  blurred.convertTo(blurF, cv.CV_32F, 1.0 / 255.0);
  blurred.delete();

  // result = src + (blur - src) * mask * suppressFactor
  // → in edge areas: blend some blurred-version to kill ringing
  // → in flat areas: no change
  const suppressFactor = 0.4;
  const diff = new cv.Mat();
  cv.subtract(blurF, srcF, diff);
  blurF.delete();

  const maskedDiff = new cv.Mat();
  cv.multiply(diff, edgeMask3ch, maskedDiff);
  diff.delete();
  edgeMask3ch.delete();

  // Scale by suppressFactor
  const dampedDiff = new cv.Mat();
  cv.addWeighted(maskedDiff, suppressFactor, maskedDiff, 0, 0, dampedDiff);
  maskedDiff.delete();

  const resultF = new cv.Mat();
  cv.add(srcF, dampedDiff, resultF);
  srcF.delete();
  dampedDiff.delete();

  const dst = new cv.Mat();
  resultF.convertTo(dst, cv.CV_8U, 255.0);
  resultF.delete();
  src.delete();

  return dst;
}
