/**
 * Focus Stack Engine — deterministic image alignment and multi-scale focus stacking.
 * Uses OpenCV.js (WASM) for feature detection, homography estimation, and warping.
 * No LLM or external API calls — pure computer vision math.
 */

import cv from '@techstark/opencv-js';
import sharp from 'sharp';
import type {
  FocusStackImage,
  FocusStackOptions,
  FocusStackResult,
  AlignmentDiagnostic,
} from './focus-stack-types.js';

// ── OpenCV Initialization Singleton ──────────────────────────────────────────

let cvReady: Promise<void> | null = null;

/** Wait for WASM runtime to initialize; cached after first call. */
function ensureCV(): Promise<void> {
  if (!cvReady) {
    cvReady = new Promise<void>((resolve) => {
      if (cv.getBuildInformation) {
        resolve();
      } else {
        cv.onRuntimeInitialized = () => resolve();
      }
    });
  }
  return cvReady;
}

// ── Helper: decode base64 image to cv.Mat (RGBA) ────────────────────────────

/** Decode base64 JPEG to OpenCV RGBA Mat via Sharp raw pixel extraction. */
async function decodeImageToMat(base64: string): Promise<{ mat: any; width: number; height: number }> {
  // Use sharp to decode to raw RGBA pixels
  const buf = Buffer.from(base64, 'base64');
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const mat = new cv.Mat(info.height, info.width, cv.CV_8UC4);
  mat.data.set(data);
  return { mat, width: info.width, height: info.height };
}

// ── Helper: cv.Mat (RGBA) to JPEG base64 via sharp ──────────────────────────

/** Convert OpenCV RGBA Mat back to JPEG base64 for API response. */
async function matToBase64(mat: any, width: number, height: number): Promise<string> {
  const rawBuf = Buffer.from(mat.data);
  const jpegBuf = await sharp(rawBuf, {
    raw: { width, height, channels: 4 },
  })
    .removeAlpha()
    .jpeg({ quality: 95, mozjpeg: true })
    .toBuffer();
  return jpegBuf.toString('base64');
}

// ── Helper: compute global Laplacian variance (sharpness score) ─────────────

/** Laplacian variance — higher value means more edges, i.e. more in-focus content. */
function computeGlobalSharpness(gray: any): number {
  const lap = new cv.Mat();
  cv.Laplacian(gray, lap, cv.CV_32F, 3);

  // Compute variance manually: mean of squared values
  const data = lap.data32F;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i] * data[i];
  }
  const variance = sum / data.length;
  lap.delete();
  return variance;
}

// ── Helper: compute multi-scale focus map ───────────────────────────────────

/** Multi-scale Laplacian focus map — 3 kernel sizes weighted 50/30/20, Gaussian smoothed. */
function computeFocusMap(gray: any, blurSigma: number): any {
  const lapFine = new cv.Mat();
  const lapMedium = new cv.Mat();
  const lapCoarse = new cv.Mat();

  cv.Laplacian(gray, lapFine, cv.CV_32F, 3);
  cv.Laplacian(gray, lapMedium, cv.CV_32F, 5);
  cv.Laplacian(gray, lapCoarse, cv.CV_32F, 7);

  // Take absolute values and weighted combination
  const focusMap = new cv.Mat(gray.rows, gray.cols, cv.CV_32F);
  const fineData = lapFine.data32F;
  const medData = lapMedium.data32F;
  const coarseData = lapCoarse.data32F;
  const outData = focusMap.data32F;

  for (let i = 0; i < outData.length; i++) {
    outData[i] =
      0.5 * Math.abs(fineData[i]) +
      0.3 * Math.abs(medData[i]) +
      0.2 * Math.abs(coarseData[i]);
  }

  lapFine.delete();
  lapMedium.delete();
  lapCoarse.delete();

  // Gaussian blur for smooth transitions
  const blurred = new cv.Mat();
  const ksize = new cv.Size(0, 0); // auto from sigma
  cv.GaussianBlur(focusMap, blurred, ksize, blurSigma, blurSigma);
  focusMap.delete();

  return blurred;
}

// ── Main: performFocusStack ─────────────────────────────────────────────────

/**
 * Main entry point — aligns images via AKAZE+Homography, computes multi-scale
 * focus maps, and composites using weighted soft blending. Returns JPEG result
 * with full diagnostics (match counts, reproj errors, timing per stage).
 */
export async function performFocusStack(
  images: FocusStackImage[],
  options?: FocusStackOptions
): Promise<FocusStackResult> {
  const opts = {
    detector: options?.detector ?? 'AKAZE',
    blurSigma: options?.blurSigma ?? 5,
    blendTransitions: options?.blendTransitions ?? true,
    blendKernelSize: options?.blendKernelSize ?? 11,
  };

  const totalStart = Date.now();
  const stagesMs: any = {};

  // ── Stage 0: Init OpenCV ────────────────────────────────────────────────
  let t = Date.now();
  await ensureCV();
  stagesMs.initialization = Date.now() - t;

  // ── Stage 1: Decode all images ──────────────────────────────────────────
  t = Date.now();
  const decoded: { mat: any; gray: any; width: number; height: number }[] = [];

  for (const img of images) {
    const { mat, width, height } = await decodeImageToMat(img.base64);
    const gray = new cv.Mat();
    cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
    decoded.push({ mat, gray, width, height });
  }

  const width = decoded[0].width;
  const height = decoded[0].height;

  // ── Stage 2: Select reference image (highest global sharpness) ──────────
  t = Date.now();
  let refIdx = 0;
  let maxSharpness = -1;
  const sharpnessScores: number[] = [];

  for (let i = 0; i < decoded.length; i++) {
    const score = computeGlobalSharpness(decoded[i].gray);
    sharpnessScores.push(score);
    if (score > maxSharpness) {
      maxSharpness = score;
      refIdx = i;
    }
  }
  stagesMs.referenceSelection = Date.now() - t;
  console.log(`[focus-stack] Reference image: #${refIdx} (sharpness: ${maxSharpness.toFixed(2)})`);

  // ── Stage 3: Feature detection ──────────────────────────────────────────
  t = Date.now();
  const detector = opts.detector === 'ORB' ? new cv.ORB() : new cv.AKAZE();

  // Detect features on reference
  const refKp = new cv.KeyPointVector();
  const refDesc = new cv.Mat();
  const emptyMask = new cv.Mat();
  detector.detectAndCompute(decoded[refIdx].gray, emptyMask, refKp, refDesc);
  console.log(`[focus-stack] Reference features: ${refKp.size()}`);

  // Detect features on all other images
  const otherFeatures: { kp: any; desc: any; idx: number }[] = [];
  for (let i = 0; i < decoded.length; i++) {
    if (i === refIdx) continue;
    const kp = new cv.KeyPointVector();
    const desc = new cv.Mat();
    detector.detectAndCompute(decoded[i].gray, emptyMask, kp, desc);
    otherFeatures.push({ kp, desc, idx: i });
    console.log(`[focus-stack] Image #${i} features: ${kp.size()}`);
  }
  stagesMs.featureDetection = Date.now() - t;

  // ── Stage 4: Feature matching + Homography ──────────────────────────────
  t = Date.now();
  const normType = opts.detector === 'ORB' ? cv.NORM_HAMMING : cv.NORM_HAMMING;
  const bf = new cv.BFMatcher(normType, false);

  const alignments: AlignmentDiagnostic[] = [];
  // Store aligned images: index -> aligned RGBA mat
  const alignedMats: Map<number, any> = new Map();
  // Valid pixel masks (1 where image has data, 0 where warped black)
  const validMasks: Map<number, any> = new Map();

  // Reference is already aligned - copy it
  alignedMats.set(refIdx, decoded[refIdx].mat.clone());
  const refMask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
  validMasks.set(refIdx, refMask);

  stagesMs.matching = 0;
  stagesMs.alignment = 0;

  for (const feat of otherFeatures) {
    const matchStart = Date.now();
    const diagnostic: AlignmentDiagnostic = {
      imageIndex: feat.idx,
      imageName: images[feat.idx].name,
      matchCount: 0,
      inlierCount: 0,
      reprojectionError: 0,
      maxTranslation: 0,
      aligned: false,
    };

    if (feat.kp.size() < 10 || refKp.size() < 10) {
      diagnostic.warning = `Insufficient features (${feat.kp.size()} detected, need 10+)`;
      alignedMats.set(feat.idx, decoded[feat.idx].mat.clone());
      const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
      validMasks.set(feat.idx, mask);
      alignments.push(diagnostic);
      continue;
    }

    // knnMatch
    const matches = new cv.DMatchVectorVector();
    bf.knnMatch(feat.desc, refDesc, matches, 2);

    // Lowe's ratio test
    const goodSrc: number[] = [];
    const goodDst: number[] = [];
    for (let m = 0; m < matches.size(); m++) {
      const pair = matches.get(m);
      if (pair.size() < 2) continue;
      const m1 = pair.get(0);
      const m2 = pair.get(1);
      if (m1.distance < 0.75 * m2.distance) {
        // Get keypoint coordinates
        const srcPt = feat.kp.get(m1.queryIdx);
        const dstPt = refKp.get(m1.trainIdx);
        goodSrc.push(srcPt.pt.x, srcPt.pt.y);
        goodDst.push(dstPt.pt.x, dstPt.pt.y);
      }
    }
    matches.delete();

    diagnostic.matchCount = goodSrc.length / 2;
    stagesMs.matching += Date.now() - matchStart;

    if (diagnostic.matchCount < 10) {
      diagnostic.warning = `Too few good matches (${diagnostic.matchCount}, need 10+)`;
      alignedMats.set(feat.idx, decoded[feat.idx].mat.clone());
      const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
      validMasks.set(feat.idx, mask);
      alignments.push(diagnostic);
      continue;
    }

    // findHomography with RANSAC
    const alignStart = Date.now();
    const srcPts = cv.matFromArray(diagnostic.matchCount, 1, cv.CV_32FC2, goodSrc);
    const dstPts = cv.matFromArray(diagnostic.matchCount, 1, cv.CV_32FC2, goodDst);
    const hMask = new cv.Mat();
    const H = cv.findHomography(srcPts, dstPts, cv.RANSAC, 3.0, hMask);

    // Validate homography
    if (H.empty() || H.rows !== 3 || H.cols !== 3) {
      diagnostic.warning = 'Homography computation failed';
      srcPts.delete(); dstPts.delete(); hMask.delete(); H.delete();
      alignedMats.set(feat.idx, decoded[feat.idx].mat.clone());
      const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
      validMasks.set(feat.idx, mask);
      alignments.push(diagnostic);
      continue;
    }

    const hData = H.data64F;
    const det = hData[0] * hData[4] * hData[8]
              - hData[0] * hData[5] * hData[7]
              - hData[1] * hData[3] * hData[8]
              + hData[1] * hData[5] * hData[6]
              + hData[2] * hData[3] * hData[7]
              - hData[2] * hData[4] * hData[6];

    if (Math.abs(det) < 0.1 || Math.abs(det) > 10) {
      diagnostic.warning = `Degenerate homography (det=${det.toFixed(4)})`;
      srcPts.delete(); dstPts.delete(); hMask.delete(); H.delete();
      alignedMats.set(feat.idx, decoded[feat.idx].mat.clone());
      const mask = new cv.Mat(height, width, cv.CV_8UC1, new cv.Scalar(255));
      validMasks.set(feat.idx, mask);
      alignments.push(diagnostic);
      continue;
    }

    // Count RANSAC inliers
    let inliers = 0;
    for (let i = 0; i < hMask.rows; i++) {
      if (hMask.ucharAt(i, 0) > 0) inliers++;
    }
    diagnostic.inlierCount = inliers;

    // Compute max translation from homography
    diagnostic.maxTranslation = Math.max(Math.abs(hData[2]), Math.abs(hData[5]));

    // Compute reprojection error on inliers
    let totalErr = 0;
    let errCount = 0;
    for (let i = 0; i < diagnostic.matchCount; i++) {
      if (hMask.ucharAt(i, 0) === 0) continue;
      const sx = goodSrc[i * 2], sy = goodSrc[i * 2 + 1];
      const dx = goodDst[i * 2], dy = goodDst[i * 2 + 1];
      const w = hData[6] * sx + hData[7] * sy + hData[8];
      const px = (hData[0] * sx + hData[1] * sy + hData[2]) / w;
      const py = (hData[3] * sx + hData[4] * sy + hData[5]) / w;
      totalErr += Math.sqrt((px - dx) ** 2 + (py - dy) ** 2);
      errCount++;
    }
    diagnostic.reprojectionError = errCount > 0 ? totalErr / errCount : 0;

    // Warp image to reference space
    const dsize = new cv.Size(width, height);
    const aligned = new cv.Mat();
    cv.warpPerspective(
      decoded[feat.idx].mat, aligned, H, dsize,
      cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(0, 0, 0, 0)
    );

    // Create valid mask from alpha channel
    const alphaChannel = new cv.Mat();
    const channels = new cv.MatVector();
    cv.split(aligned, channels);
    // Alpha is channel 3
    const vMask = channels.get(3).clone();
    channels.delete();

    alignedMats.set(feat.idx, aligned);
    validMasks.set(feat.idx, vMask);
    diagnostic.aligned = true;

    console.log(`[focus-stack] Image #${feat.idx}: ${diagnostic.matchCount} matches, ${inliers} inliers, reproj=${diagnostic.reprojectionError.toFixed(2)}px, translation=${diagnostic.maxTranslation.toFixed(1)}px`);

    srcPts.delete(); dstPts.delete(); hMask.delete(); H.delete();
    stagesMs.alignment += Date.now() - alignStart;
    alignments.push(diagnostic);
  }

  // Clean up feature detection objects
  refKp.delete(); refDesc.delete(); emptyMask.delete(); detector.delete(); bf.delete();
  for (const feat of otherFeatures) {
    feat.kp.delete(); feat.desc.delete();
  }

  // ── Stage 5: Compute focus maps on aligned images ───────────────────────
  t = Date.now();
  const focusMaps: Map<number, any> = new Map();

  for (let i = 0; i < decoded.length; i++) {
    const alignedMat = alignedMats.get(i)!;
    const gray = new cv.Mat();
    cv.cvtColor(alignedMat, gray, cv.COLOR_RGBA2GRAY);

    const focusMap = computeFocusMap(gray, opts.blurSigma);

    // Zero out invalid regions
    const mask = validMasks.get(i)!;
    const maskFloat = new cv.Mat();
    mask.convertTo(maskFloat, cv.CV_32F, 1.0 / 255.0);
    const maskedFocus = new cv.Mat();
    cv.multiply(focusMap, maskFloat, maskedFocus);

    focusMaps.set(i, maskedFocus);
    gray.delete();
    focusMap.delete();
    maskFloat.delete();
  }
  stagesMs.focusMapComputation = Date.now() - t;

  // ── Stage 6: Weighted compositing ───────────────────────────────────────
  t = Date.now();
  const numImages = decoded.length;
  const totalPixels = width * height;

  // Build weight maps
  const weightMaps: Float32Array[] = [];
  for (let i = 0; i < numImages; i++) {
    weightMaps.push(new Float32Array(focusMaps.get(i)!.data32F));
  }

  // Normalize weights per pixel
  for (let p = 0; p < totalPixels; p++) {
    let total = 0;
    for (let i = 0; i < numImages; i++) {
      total += weightMaps[i][p];
    }
    if (total > 1e-6) {
      for (let i = 0; i < numImages; i++) {
        weightMaps[i][p] /= total;
      }
    } else {
      // Equal weight in flat areas
      const eq = 1.0 / numImages;
      for (let i = 0; i < numImages; i++) {
        weightMaps[i][p] = eq;
      }
    }
  }

  // Smooth weight maps for blending if enabled
  if (opts.blendTransitions) {
    for (let i = 0; i < numImages; i++) {
      const wMat = new cv.Mat(height, width, cv.CV_32F);
      wMat.data32F.set(weightMaps[i]);
      const blurred = new cv.Mat();
      const ksize = new cv.Size(0, 0);
      const sigma = opts.blendKernelSize / 2;
      cv.GaussianBlur(wMat, blurred, ksize, sigma, sigma);
      weightMaps[i] = new Float32Array(blurred.data32F);
      wMat.delete();
      blurred.delete();
    }

    // Re-normalize after blur
    for (let p = 0; p < totalPixels; p++) {
      let total = 0;
      for (let i = 0; i < numImages; i++) {
        total += weightMaps[i][p];
      }
      if (total > 1e-6) {
        for (let i = 0; i < numImages; i++) {
          weightMaps[i][p] /= total;
        }
      }
    }
  }

  // Composite
  const resultMat = new cv.Mat(height, width, cv.CV_8UC4);
  const resultData = resultMat.data;

  // Pre-extract image data arrays for fast access
  const imageDataArrays: Uint8Array[] = [];
  for (let i = 0; i < numImages; i++) {
    imageDataArrays.push(alignedMats.get(i)!.data);
  }

  for (let p = 0; p < totalPixels; p++) {
    const pixIdx = p * 4;
    let rAcc = 0, gAcc = 0, bAcc = 0, aAcc = 0;

    for (let i = 0; i < numImages; i++) {
      const w = weightMaps[i][p];
      if (w < 1e-6) continue;
      const imgData = imageDataArrays[i];
      rAcc += imgData[pixIdx] * w;
      gAcc += imgData[pixIdx + 1] * w;
      bAcc += imgData[pixIdx + 2] * w;
      aAcc += imgData[pixIdx + 3] * w;
    }

    resultData[pixIdx] = Math.min(255, Math.max(0, Math.round(rAcc)));
    resultData[pixIdx + 1] = Math.min(255, Math.max(0, Math.round(gAcc)));
    resultData[pixIdx + 2] = Math.min(255, Math.max(0, Math.round(bAcc)));
    resultData[pixIdx + 3] = Math.min(255, Math.max(0, Math.round(aAcc)));
  }

  // Fill edges from reference where alpha < 255 (warping gaps)
  const refData = alignedMats.get(refIdx)!.data;
  for (let p = 0; p < totalPixels; p++) {
    const pixIdx = p * 4;
    if (resultData[pixIdx + 3] < 200) {
      resultData[pixIdx] = refData[pixIdx];
      resultData[pixIdx + 1] = refData[pixIdx + 1];
      resultData[pixIdx + 2] = refData[pixIdx + 2];
      resultData[pixIdx + 3] = 255;
    }
  }

  stagesMs.compositing = Date.now() - t;

  // ── Stage 7: Encode result ──────────────────────────────────────────────
  t = Date.now();
  const resultBase64 = await matToBase64(resultMat, width, height);
  stagesMs.encoding = Date.now() - t;

  // ── Cleanup ─────────────────────────────────────────────────────────────
  for (const d of decoded) {
    d.mat.delete();
    d.gray.delete();
  }
  for (const [, mat] of alignedMats) mat.delete();
  for (const [, mask] of validMasks) mask.delete();
  for (const [, fm] of focusMaps) fm.delete();
  resultMat.delete();

  const totalTimeMs = Date.now() - totalStart;
  console.log(`[focus-stack] Complete in ${totalTimeMs}ms`);

  return {
    result: {
      base64: resultBase64,
      mimeType: 'image/jpeg',
      width,
      height,
    },
    diagnostics: {
      referenceIndex: refIdx,
      referenceSharpness: maxSharpness,
      alignments,
      totalTimeMs,
      stagesMs,
    },
  };
}
