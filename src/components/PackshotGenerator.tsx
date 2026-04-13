/**
 * Main generation UI — three methods (AI/Aligned/Quick), post-processing
 * adjustments (gamma, RGB, vibrance, sharpen), interactive crop, and TIFF export.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Download, RefreshCw, Layers, Camera, Image as ImageIcon, Sun, Palette, Zap, Target, SlidersHorizontal, Wand2, MessageSquare, Send, Crop, Check, X, Crown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../lib/auth-context';
import { AICreditsPanel } from './AICreditsPanel';
import { AuthModal } from './AuthModal';
// AI functions — proxied through server, supports multi-provider via `provider` field
const generatePackshot = async (images: { base64: string; mimeType: string }[], provider?: string): Promise<string> => {
  const res = await fetch('/api/generate-packshot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ images, provider }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Generation failed'); }
  return (await res.json()).image;
};

const homogenizePackshot = async (currentImage: string, sourceImages: { base64: string; mimeType: string }[], burnt: number, dark: number, provider?: string): Promise<string> => {
  const res = await fetch('/api/homogenize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ currentImage, sourceImages, burnt, dark, provider }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Homogenization failed'); }
  return (await res.json()).image;
};

const editPackshot = async (currentImage: string, sourceImages: { base64: string; mimeType: string }[], prompt: string, provider?: string): Promise<string> => {
  const res = await fetch('/api/edit-packshot', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ currentImage, sourceImages, prompt, provider }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Edit failed'); }
  return (await res.json()).image;
};

interface ProcessedImage {
  name: string;
  base64: string;
  mimeType: string;
}

interface PackshotGeneratorProps {
  images: ProcessedImage[];
  onReset: () => void;
}

interface Adjustments {
  gammaBg: number;
  gammaObj: number;
  r: number;
  g: number;
  b: number;
  vibrance: number;
  sharpen: number;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEFAULT_ADJUSTMENTS: Adjustments = {
  gammaBg: 1,
  gammaObj: 1,
  r: 1,
  g: 1,
  b: 1,
  vibrance: 0,
  sharpen: 0
};

/** Formats available only on Pro/Studio tiers. */
const FREE_FORMATS = new Set(['jpeg', 'png']);

export const PackshotGenerator: React.FC<PackshotGeneratorProps> = ({ images, onReset }) => {
  const { user, createCheckout, refreshUser, removeWatermark, rewards, refreshRewards } = useAuth();
  const [showWatermarkOptions, setShowWatermarkOptions] = useState(false);
  const tier = user?.tier || 'free';
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMethod, setGenerationMethod] = useState<'ai' | 'mathematical' | 'aligned-stack'>('aligned-stack');
  const [isHomogenizing, setIsHomogenizing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [homogenizeSettings, setHomogenizeSettings] = useState({ burnt: 15, dark: 15 });
  const [showHomogenizeOptions, setShowHomogenizeOptions] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  // Free tier defaults to JPEG (only JPEG/PNG allowed); Pro/Studio default to TIFF (print quality)
  const [exportFormat, setExportFormat] = useState<string>(tier === 'free' ? 'jpeg' : 'tiff');
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Reset default format when tier changes (e.g. after login)
  useEffect(() => {
    setExportFormat(tier === 'free' ? 'jpeg' : 'tiff');
  }, [tier]);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [aiProvider, setAiProvider] = useState<string | undefined>(undefined); // user's preferred provider

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cropOverlayRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);
  const dragStateRef = useRef<{ type: string; startX: number; startY: number; startRect: CropRect } | null>(null);
  const [imageLoadCounter, setImageLoadCounter] = useState(0); // bump to trigger canvas redraw after image loads

  // Reset state when source images change to prevent caching old results
  useEffect(() => {
    setResultImage(null);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    originalImageRef.current = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [images]);

  const rafRef = useRef<number | null>(null);

  /** Dispatch to selected generation method: AI, aligned stack, or quick stack. */
  const handleGenerate = async () => {
    // Anonymous users must sign in before generating — we can't track their usage otherwise
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    if (generationMethod === 'ai') {
      setIsGenerating(true);
      setError(null);
      setAdjustments(DEFAULT_ADJUSTMENTS);
      try {
        const result = await generatePackshot(images, aiProvider);
        setResultImage(result);
        refreshUser(); // Refresh usage counter after successful generation

        // Pre-load image for canvas processing
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = result;
        img.onload = () => {
          originalImageRef.current = img;
          setImageLoadCounter(c => c + 1);
        };
      } catch (err: any) {
        console.error('Generation error:', err);
        if (err.message === 'API_KEY_ERROR') {
          setError('API Key error. Please refresh and select a valid key.');
        } else {
          setError('Failed to generate packshot. Please try again.');
        }
      } finally {
        setIsGenerating(false);
      }
    } else if (generationMethod === 'mathematical') {
      await handleMathematicalStacking();
    } else {
      await handleAlignedStacking();
    }
  };

  /** Quick stack — client-side Laplacian per-pixel selection, no alignment. */
  const handleMathematicalStacking = async () => {
    setIsGenerating(true);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    try {
      // 1. Load all images into Image objects
      const loadedImages = await Promise.all(images.map(img => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = `data:${img.mimeType};base64,${img.base64}`;
        });
      }));

      if (loadedImages.length === 0) return;

      const width = loadedImages[0].width;
      const height = loadedImages[0].height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get canvas context");

      // 2. Get ImageData for all images
      const allImageData = loadedImages.map(img => {
        ctx.drawImage(img, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      });

      // 3. Compute focus measure (Laplacian variance)
      const focusMaps = allImageData.map(() => new Float32Array(width * height));

      allImageData.forEach((id, imgIdx) => {
        const data = id.data;
        const focusMap = focusMaps[imgIdx];
        const lumMap = new Float32Array(width * height);
        
        // Pre-calculate luminance
        for (let i = 0; i < width * height; i++) {
          const idx = i * 4;
          lumMap[i] = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
        }

        // Laplacian kernel
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const laplacian = Math.abs(
              4 * lumMap[idx] - lumMap[idx - 1] - lumMap[idx + 1] - lumMap[idx - width] - lumMap[idx + width]
            );
            focusMap[idx] = laplacian;
          }
        }
        
        // Smooth focus map with a box blur to reduce noise and artifacts
        const smoothedFocusMap = new Float32Array(width * height);
        const radius = 3;
        for (let y = radius; y < height - radius; y++) {
          for (let x = radius; x < width - radius; x++) {
            let sum = 0;
            for (let ky = -radius; ky <= radius; ky++) {
              for (let kx = -radius; kx <= radius; kx++) {
                sum += focusMap[(y + ky) * width + (x + kx)];
              }
            }
            smoothedFocusMap[y * width + x] = sum;
          }
        }
        focusMaps[imgIdx] = smoothedFocusMap;
      });

      // 4. Select best pixel from all images
      const resultData = ctx.createImageData(width, height);
      for (let i = 0; i < width * height; i++) {
        let bestImgIdx = 0;
        let maxFocus = -1;
        for (let imgIdx = 0; imgIdx < allImageData.length; imgIdx++) {
          if (focusMaps[imgIdx][i] > maxFocus) {
            maxFocus = focusMaps[imgIdx][i];
            bestImgIdx = imgIdx;
          }
        }

        const pixelIdx = i * 4;
        resultData.data[pixelIdx] = allImageData[bestImgIdx].data[pixelIdx];
        resultData.data[pixelIdx + 1] = allImageData[bestImgIdx].data[pixelIdx + 1];
        resultData.data[pixelIdx + 2] = allImageData[bestImgIdx].data[pixelIdx + 2];
        resultData.data[pixelIdx + 3] = 255;
      }

      ctx.putImageData(resultData, 0, 0);
      const result = canvas.toDataURL('image/png');
      setResultImage(result);
      refreshUser(); // Refresh usage counter after successful stack

      const img = new Image();
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        setImageLoadCounter(c => c + 1);
      };
    } catch (err) {
      console.error('Mathematical stacking error:', err);
      setError('Failed to process focus stacking. Ensure images are the same size.');
    } finally {
      setIsGenerating(false);
    }
  };

  /** Aligned stack — server-side OpenCV alignment + multi-scale focus compositing. */
  const handleAlignedStacking = async () => {
    setIsGenerating(true);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    try {
      const response = await fetch('/api/focus-stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          images: images.map(img => ({
            name: img.name,
            base64: img.base64,
            mimeType: img.mimeType,
          })),
          options: { detector: 'AKAZE', blendTransitions: true },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Focus stacking failed');
      }

      const data = await response.json();
      const resultDataUrl = `data:${data.result.mimeType};base64,${data.result.base64}`;
      setResultImage(resultDataUrl);
      refreshUser(); // Refresh usage counter after successful stack

      // Log diagnostics
      console.log('[aligned-stack] Diagnostics:', data.diagnostics);

      const img = new Image();
      img.src = resultDataUrl;
      img.onload = () => {
        originalImageRef.current = img;
        setImageLoadCounter(c => c + 1);
      };
    } catch (err: any) {
      console.error('Aligned stacking error:', err);
      setError(err.message || 'Failed to perform aligned focus stacking.');
    } finally {
      setIsGenerating(false);
    }
  };

  /** Send current result + sources to Gemini for lighting balance correction. */
  const handleHomogenize = async () => {
    if (!resultImage) return;
    setIsHomogenizing(true);
    setError(null);
    setShowHomogenizeOptions(false);
    try {
      const result = await homogenizePackshot(resultImage, images, homogenizeSettings.burnt, homogenizeSettings.dark, aiProvider);
      setResultImage(result);
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        setImageLoadCounter(c => c + 1);
      };
    } catch (err: any) {
      console.error('Homogenization error:', err);
      setError('Failed to homogenize lighting. Please try again.');
    } finally {
      setIsHomogenizing(false);
    }
  };

  /** Apply user's free-form edit prompt via Gemini (e.g. "change cap to red"). */
  const handleEdit = async () => {
    if (!resultImage || !editPrompt.trim()) return;
    setIsEditing(true);
    setError(null);
    try {
      const result = await editPackshot(resultImage, images, editPrompt, aiProvider);
      setResultImage(result);
      setEditPrompt('');
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        setImageLoadCounter(c => c + 1);
      };
    } catch (err: any) {
      console.error('Edit error:', err);
      setError('Failed to apply edits. Please try again.');
    } finally {
      setIsEditing(false);
    }
  };

  /** Redraw canvas with gamma, RGB, vibrance, sharpen — all client-side pixel math. */
  const applyAdjustments = () => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const { gammaBg, gammaObj, r, g, b, vibrance, sharpen } = adjustments;

    // 1. Color and Gamma Pass
    for (let i = 0; i < data.length; i += 4) {
      let red = data[i];
      let green = data[i + 1];
      let blue = data[i + 2];

      // Background/Object separation (simple threshold)
      const brightness = (red + green + blue) / 3;
      const isBg = brightness > 240;
      const gamma = isBg ? gammaBg : gammaObj;

      // Apply Gamma
      if (gamma !== 1) {
        red = 255 * Math.pow(red / 255, 1 / gamma);
        green = 255 * Math.pow(green / 255, 1 / gamma);
        blue = 255 * Math.pow(blue / 255, 1 / gamma);
      }

      // Apply RGB (Object Only)
      if (!isBg) {
        red *= r;
        green *= g;
        blue *= b;
      }

      // Apply Vibrance (simplified)
      if (vibrance !== 0) {
        const avg = (red + green + blue) / 3;
        const max = Math.max(red, green, blue);
        const amt = (Math.abs(max - avg) / 255) * vibrance;
        red += (red - avg) * amt;
        green += (green - avg) * amt;
        blue += (blue - avg) * amt;
      }

      const finalR = Math.min(255, Math.max(0, red));
      const finalG = Math.min(255, Math.max(0, green));
      const finalB = Math.min(255, Math.max(0, blue));

      data[i] = finalR;
      data[i + 1] = finalG;
      data[i + 2] = finalB;
    }

    // 2. Sharpen Pass (Convolution)
    let processedData = data;
    if (sharpen > 0) {
      const weights = [
        0, -sharpen, 0,
        -sharpen, 1 + 4 * sharpen, -sharpen,
        0, -sharpen, 0
      ];
      const side = 3;
      const halfSide = 1;
      const sw = canvas.width;
      const sh = canvas.height;
      const output = new Uint8ClampedArray(data.length);

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const dstOff = (y * sw + x) * 4;
          let r_acc = 0, g_acc = 0, b_acc = 0;
          for (let cy = 0; cy < side; cy++) {
            for (let cx = 0; cx < side; cx++) {
              const scy = y + cy - halfSide;
              const scx = x + cx - halfSide;
              if (scy >= 0 && scy < sh && scx >= 0 && scx < sw) {
                const srcOff = (scy * sw + scx) * 4;
                const wt = weights[cy * side + cx];
                r_acc += data[srcOff] * wt;
                g_acc += data[srcOff + 1] * wt;
                b_acc += data[srcOff + 2] * wt;
              }
            }
          }
          output[dstOff] = Math.min(255, Math.max(0, r_acc));
          output[dstOff + 1] = Math.min(255, Math.max(0, g_acc));
          output[dstOff + 2] = Math.min(255, Math.max(0, b_acc));
          output[dstOff + 3] = data[dstOff + 3];
        }
      }
      processedData = output;
    }

    // 3. Final Composition
    ctx.putImageData(new ImageData(processedData, canvas.width, canvas.height), 0, 0);
  };

  useEffect(() => {
    // Skip while loading state is active — canvas is not yet mounted (AnimatePresence shows spinner)
    if (isGenerating || isHomogenizing || isEditing) return;
    if (!resultImage || !originalImageRef.current) return;

    // Poll for canvas mount (AnimatePresence mode="wait" delays mounting until exit animation completes)
    let cancelled = false;
    let attempts = 0;
    const tryDraw = () => {
      if (cancelled) return;
      if (canvasRef.current) {
        applyAdjustments();
      } else if (attempts < 60) { // retry for up to ~1 second
        attempts++;
        rafRef.current = requestAnimationFrame(tryDraw);
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tryDraw);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [adjustments, resultImage, imageLoadCounter, isGenerating, isHomogenizing, isEditing]);

  // ── Crop Functions ──────────────────────────────────────────────────────

  /** Compute CSS-to-image coordinate mapping for object-contain canvas scaling. */
  const getCanvasToImageScale = () => {
    const canvas = canvasRef.current;
    if (!canvas) return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    const rect = canvas.getBoundingClientRect();
    const imgW = canvas.width;
    const imgH = canvas.height;
    const displayAspect = rect.width / rect.height;
    const imgAspect = imgW / imgH;
    let renderW: number, renderH: number, offsetX: number, offsetY: number;
    if (imgAspect > displayAspect) {
      renderW = rect.width;
      renderH = rect.width / imgAspect;
      offsetX = 0;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderH = rect.height;
      renderW = rect.height * imgAspect;
      offsetX = (rect.width - renderW) / 2;
      offsetY = 0;
    }
    return { scaleX: imgW / renderW, scaleY: imgH / renderH, offsetX, offsetY, renderW, renderH };
  };

  const cssToImage = (cssX: number, cssY: number) => {
    const { scaleX, scaleY, offsetX, offsetY } = getCanvasToImageScale();
    return {
      x: (cssX - offsetX) * scaleX,
      y: (cssY - offsetY) * scaleY,
    };
  };

  const imageToCSS = (imgX: number, imgY: number) => {
    const { scaleX, scaleY, offsetX, offsetY } = getCanvasToImageScale();
    return {
      x: imgX / scaleX + offsetX,
      y: imgY / scaleY + offsetY,
    };
  };

  /** Initialize crop with 5% margin inset — user drags handles to adjust. */
  const startCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const margin = Math.min(canvas.width, canvas.height) * 0.05;
    setCropRect({ x: margin, y: margin, w: canvas.width - margin * 2, h: canvas.height - margin * 2 });
    setIsCropping(true);
  };

  const cancelCrop = () => {
    setIsCropping(false);
    setCropRect(null);
  };

  /** Extract cropped region, replace originalImageRef, re-apply adjustments. */
  const applyCrop = () => {
    const canvas = canvasRef.current;
    if (!canvas || !cropRect) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cx = Math.round(Math.max(0, cropRect.x));
    const cy = Math.round(Math.max(0, cropRect.y));
    const cw = Math.round(Math.min(cropRect.w, canvas.width - cx));
    const ch = Math.round(Math.min(cropRect.h, canvas.height - cy));

    const croppedData = ctx.getImageData(cx, cy, cw, ch);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = cw;
    tmpCanvas.height = ch;
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(croppedData, 0, 0);

    const dataUrl = tmpCanvas.toDataURL('image/png');
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      originalImageRef.current = img;
      setResultImage(dataUrl);
      setIsCropping(false);
      setCropRect(null);
      setImageLoadCounter(c => c + 1);
    };
  };

  /** Render dark mask, crop border, rule-of-thirds grid, and drag handles. */
  const drawCropOverlay = () => {
    const overlay = cropOverlayRef.current;
    const canvas = canvasRef.current;
    if (!overlay || !canvas || !cropRect) return;

    const rect = canvas.getBoundingClientRect();
    overlay.width = rect.width;
    overlay.height = rect.height;
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const tl = imageToCSS(cropRect.x, cropRect.y);
    const br = imageToCSS(cropRect.x + cropRect.w, cropRect.y + cropRect.h);
    const cssW = br.x - tl.x;
    const cssH = br.y - tl.y;

    // Dark mask outside crop
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, overlay.width, overlay.height);
    ctx.clearRect(tl.x, tl.y, cssW, cssH);

    // Crop border
    ctx.strokeStyle = '#f97316';
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x, tl.y, cssW, cssH);

    // Rule of thirds lines
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(tl.x + cssW * i / 3, tl.y);
      ctx.lineTo(tl.x + cssW * i / 3, tl.y + cssH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(tl.x, tl.y + cssH * i / 3);
      ctx.lineTo(tl.x + cssW, tl.y + cssH * i / 3);
      ctx.stroke();
    }

    // Handles
    const handleSize = 8;
    ctx.fillStyle = '#f97316';
    const handles = [
      { x: tl.x, y: tl.y }, { x: tl.x + cssW / 2, y: tl.y }, { x: tl.x + cssW, y: tl.y },
      { x: tl.x, y: tl.y + cssH / 2 }, { x: tl.x + cssW, y: tl.y + cssH / 2 },
      { x: tl.x, y: tl.y + cssH }, { x: tl.x + cssW / 2, y: tl.y + cssH }, { x: tl.x + cssW, y: tl.y + cssH },
    ];
    handles.forEach(h => {
      ctx.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    });

    // Dimensions label
    ctx.fillStyle = 'rgba(249, 115, 22, 0.9)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(cropRect.w)} × ${Math.round(cropRect.h)}`, tl.x + cssW / 2, tl.y - 8);
  };

  useEffect(() => {
    if (isCropping && cropRect) {
      drawCropOverlay();
    }
  }, [isCropping, cropRect]);

  /** Hit-test which handle (tl/tr/bl/br/t/b/l/r/move) the cursor is near. */
  const getHandle = (cssX: number, cssY: number): string => {
    if (!cropRect) return '';
    const tl = imageToCSS(cropRect.x, cropRect.y);
    const br = imageToCSS(cropRect.x + cropRect.w, cropRect.y + cropRect.h);
    const tolerance = 16; // wider hitbox so edges feel snappy
    // Asymmetric: extend hit range slightly past the visible border so it works
    // even when cursor overshoots bottom/right edges
    const onLeft = cssX >= tl.x - tolerance && cssX <= tl.x + tolerance;
    const onRight = cssX >= br.x - tolerance && cssX <= br.x + tolerance;
    const onTop = cssY >= tl.y - tolerance && cssY <= tl.y + tolerance;
    const onBottom = cssY >= br.y - tolerance && cssY <= br.y + tolerance;
    // Corners first (they take priority over edges)
    if (onTop && onLeft) return 'tl';
    if (onTop && onRight) return 'tr';
    if (onBottom && onLeft) return 'bl';
    if (onBottom && onRight) return 'br';
    // Edges — must also be within the perpendicular range
    if (onTop && cssX >= tl.x && cssX <= br.x) return 't';
    if (onBottom && cssX >= tl.x && cssX <= br.x) return 'b';
    if (onLeft && cssY >= tl.y && cssY <= br.y) return 'l';
    if (onRight && cssY >= tl.y && cssY <= br.y) return 'r';
    // Inside — move
    if (cssX > tl.x && cssX < br.x && cssY > tl.y && cssY < br.y) return 'move';
    return '';
  };

  const handleCropMouseDown = (e: React.MouseEvent) => {
    if (!cropRect) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const handle = getHandle(cssX, cssY);
    if (!handle) return;
    dragStateRef.current = { type: handle, startX: cssX, startY: cssY, startRect: { ...cropRect } };
    e.preventDefault();
  };

  const handleCropMouseMove = (e: React.MouseEvent) => {
    const overlay = cropOverlayRef.current;
    if (!overlay || !cropRect) return;
    const rect = overlay.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // Update cursor
    const handle = dragStateRef.current?.type || getHandle(cssX, cssY);
    const cursors: Record<string, string> = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize', t: 'n-resize', b: 's-resize', l: 'w-resize', r: 'e-resize', move: 'move' };
    overlay.style.cursor = cursors[handle] || 'default';

    if (!dragStateRef.current) return;
    const { type, startX, startY, startRect } = dragStateRef.current;
    const img = cssToImage(cssX, cssY);
    const startImg = cssToImage(startX, startY);
    const dx = img.x - startImg.x;
    const dy = img.y - startImg.y;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxW = canvas.width;
    const maxH = canvas.height;

    let { x, y, w, h } = startRect;
    const minSize = 50;

    if (type === 'move') {
      x = Math.max(0, Math.min(maxW - w, x + dx));
      y = Math.max(0, Math.min(maxH - h, y + dy));
    } else {
      if (type.includes('l')) { const nx = Math.max(0, x + dx); w = w + (x - nx); x = nx; }
      if (type.includes('r')) { w = Math.max(minSize, Math.min(maxW - x, w + dx)); }
      if (type.includes('t')) { const ny = Math.max(0, y + dy); h = h + (y - ny); y = ny; }
      if (type.includes('b')) { h = Math.max(minSize, Math.min(maxH - y, h + dy)); }
      if (w < minSize) w = minSize;
      if (h < minSize) h = minSize;
    }

    setCropRect({ x, y, w, h });
  };

  const handleCropMouseUp = () => {
    dragStateRef.current = null;
  };

  /** Send canvas content to server for format conversion and trigger browser download. */
  const downloadResult = async (format: string = exportFormat) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDownloading(true);
    setShowExportMenu(false);
    try {
      const imageBase64 = canvas.toDataURL('image/png');

      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ imageBase64, format }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        if (response.status === 403 && errData?.code === 'FORMAT_RESTRICTED') {
          setError(`${format.toUpperCase()} requires Pro. Free tier supports JPEG and PNG. Sign up for Pro to unlock all formats.`);
          return;
        }
        if (response.status === 402) {
          setError(errData?.error || 'Monthly limit reached. Sign up or upgrade for more.');
          return;
        }
        throw new Error(errData?.error || `Failed to export as ${format.toUpperCase()}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const ext = format === 'jpeg' ? 'jpg' : format;
      link.download = `packshot-${Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      // Refresh rewards to reflect consumed watermark credit (if any)
      if (tier === 'free' && user) refreshRewards();
    } catch (err) {
      console.error('Download error:', err);
      setError(`Failed to download as ${format.toUpperCase()}. Please try again.`);
    } finally {
      setIsDownloading(false);
    }
  };

  const updateAdj = (key: keyof Adjustments, val: number) => {
    setAdjustments(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Source Images Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                <Layers className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight">Source Data</h3>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{images.length} Processed RAW Frames</p>
              </div>
            </div>
            <button
              onClick={onReset}
              className="flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-gray-400 hover:text-white transition-all text-[10px] font-mono uppercase tracking-widest"
              aria-label="Start new — upload different files"
              title="Start new packshot"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Start New</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {images.map((img, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-[#151619] group relative"
              >
                <img 
                  src={`data:${img.mimeType};base64,${img.base64}`} 
                  alt={img.name} 
                  className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                  referrerPolicy="no-referrer"
                />
              </motion.div>
            ))}
          </div>

          {!resultImage && (
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-3 gap-2 bg-white/5 p-1.5 rounded-2xl border border-white/10">
                <button
                  onClick={() => setGenerationMethod('mathematical')}
                  className={`flex flex-col items-center justify-center gap-1.5 py-4 px-2 rounded-xl transition-all ${generationMethod === 'mathematical' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Layers className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Quick</span>
                </button>
                <button
                  onClick={() => setGenerationMethod('aligned-stack')}
                  className={`flex flex-col items-center justify-center gap-1.5 py-4 px-2 rounded-xl transition-all ${generationMethod === 'aligned-stack' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                >
                  <Target className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">Aligned</span>
                </button>
                <button
                  onClick={() => setGenerationMethod('ai')}
                  className={`flex flex-col items-center justify-center gap-1.5 py-4 px-2 rounded-xl transition-all relative ${
                    generationMethod === 'ai'
                      ? (tier === 'free' ? 'bg-gray-700 text-gray-400' : 'bg-orange-500 text-white shadow-lg shadow-orange-500/20')
                      : (tier === 'free' ? 'text-gray-600 hover:text-gray-400 hover:bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5')
                  }`}
                >
                  <Sparkles className="w-5 h-5" />
                  <span className="text-xs font-bold uppercase tracking-wider">AI</span>
                  {tier === 'free' && (
                    <Crown className="w-3 h-3 absolute top-1.5 right-1.5 text-orange-500/70" />
                  )}
                </button>
              </div>

              {generationMethod === 'ai' && (
                <div className="space-y-3">
                  <AICreditsPanel />
                  {/* Provider selector */}
                  {tier !== 'free' && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl">
                      <span className="text-[9px] font-mono uppercase tracking-widest text-gray-500 shrink-0">Provider:</span>
                      <select
                        value={aiProvider || ''}
                        onChange={(e) => setAiProvider(e.target.value || undefined)}
                        className="flex-1 bg-transparent text-xs text-white font-mono uppercase tracking-widest border-none outline-none cursor-pointer appearance-none"
                      >
                        <option value="" className="bg-[#1a1b1f]">Auto (best available)</option>
                        <option value="gemini" className="bg-[#1a1b1f]">Google Gemini</option>
                        <option value="openai" className="bg-[#1a1b1f]">OpenAI</option>
                        <option value="grok" className="bg-[#1a1b1f]">xAI Grok</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-6 rounded-2xl transition-all active:scale-95 flex items-center justify-center space-x-4 shadow-2xl shadow-orange-500/20 uppercase tracking-[0.2em] text-sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{generationMethod === 'ai' ? 'Synthesizing...' : generationMethod === 'aligned-stack' ? 'Aligning & Stacking...' : 'Stacking...'}</span>
                  </>
                ) : (
                  <>
                    {generationMethod === 'ai' ? <Sparkles className="w-6 h-6" /> : generationMethod === 'aligned-stack' ? <Target className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
                    <span>{generationMethod === 'ai' ? 'Generate Studio Packshot' : generationMethod === 'aligned-stack' ? 'Run Aligned Focus Stack' : 'Run Quick Stacking'}</span>
                  </>
                )}
              </button>
              
              <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.15em] text-center px-4 leading-relaxed">
                {generationMethod === 'ai'
                  ? `Uses ${aiProvider === 'openai' ? 'OpenAI GPT-4o' : aiProvider === 'grok' ? 'xAI Grok' : 'Gemini 3.1 Flash'} to synthesize a perfect studio packshot with pure white background.`
                  : generationMethod === 'aligned-stack'
                  ? 'Server-side OpenCV alignment + multi-scale focus stacking. Corrects camera vibration, no LLM involved.'
                  : 'Client-side quick stacking: Combines sharpest parts without alignment. Fast but may show ghosting.'}
              </p>
            </div>
          )}
        </div>

        {/* Result Panel */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                <Camera className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight">Final Output</h3>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
                  {generationMethod === 'ai' ? 'AI Generated Studio Quality' : generationMethod === 'aligned-stack' ? 'Aligned Focus Stack · Non-AI' : 'Quick Focus Stack · Non-AI'}
                </p>
              </div>
            </div>
            {resultImage && (
              <div className="flex items-center space-x-3 relative">
                <div className="relative">
                  <button 
                    onClick={() => setShowHomogenizeOptions(!showHomogenizeOptions)}
                    disabled={isHomogenizing}
                    className={`flex items-center space-x-2 px-4 py-2 ${showHomogenizeOptions ? 'bg-white/20' : 'bg-white/5'} hover:bg-white/10 text-white border border-white/10 rounded-xl transition-all font-bold text-xs uppercase tracking-widest disabled:opacity-50`}
                  >
                    {isHomogenizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4 text-orange-500" />
                    )}
                    <span>Homogenize</span>
                  </button>

                  <AnimatePresence>
                    {showHomogenizeOptions && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 w-64 bg-[#1a1b1e] border border-white/10 rounded-2xl p-6 shadow-2xl z-50 space-y-6"
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-400">
                            <span>Burnt Reduction</span>
                            <span className="text-orange-500">{homogenizeSettings.burnt}%</span>
                          </div>
                          <input 
                            type="range"
                            min={0}
                            max={50}
                            step={1}
                            value={homogenizeSettings.burnt}
                            onChange={(e) => setHomogenizeSettings(prev => ({ ...prev, burnt: parseInt(e.target.value) }))}
                            className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-400">
                            <span>Dark Increase</span>
                            <span className="text-orange-500">{homogenizeSettings.dark}%</span>
                          </div>
                          <input 
                            type="range"
                            min={0}
                            max={50}
                            step={1}
                            value={homogenizeSettings.dark}
                            onChange={(e) => setHomogenizeSettings(prev => ({ ...prev, dark: parseInt(e.target.value) }))}
                            className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                        </div>

                        <button 
                          onClick={handleHomogenize}
                          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-[0.2em] transition-all"
                        >
                          Apply Homogenization
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {!isCropping ? (
                  <button
                    onClick={startCrop}
                    className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl transition-all font-bold text-xs uppercase tracking-widest"
                  >
                    <Crop className="w-4 h-4 text-orange-500" />
                    <span>Crop</span>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={applyCrop}
                      className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl transition-all font-bold text-xs uppercase tracking-widest"
                    >
                      <Check className="w-4 h-4" />
                      <span>Apply Crop</span>
                    </button>
                    <button
                      onClick={cancelCrop}
                      className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-white border border-white/10 rounded-xl transition-all font-bold text-xs uppercase tracking-widest"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel</span>
                    </button>
                  </>
                )}

                <div className="relative flex flex-col items-stretch">
                  <div className="flex">
                    <button
                      onClick={() => downloadResult()}
                      disabled={isDownloading || isCropping}
                      className="flex items-center space-x-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-l-xl transition-all font-bold text-xs uppercase tracking-widest disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      <span>{isDownloading ? 'Exporting...' : `Download ${exportFormat.toUpperCase()}`}</span>
                    </button>
                    <button
                      onClick={() => setShowExportMenu(!showExportMenu)}
                      disabled={isDownloading || isCropping}
                      className="px-2 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-r-xl border-l border-orange-700 transition-all disabled:opacity-50"
                      aria-label="Choose export format"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                  </div>

                  {/* Watermark status (free tier only) */}
                  {tier === 'free' && (
                    rewards && rewards.watermarkExports > 0 ? (
                      <div className="mt-1.5 flex items-center justify-center gap-1.5 text-[9px] text-green-400 font-mono uppercase tracking-widest">
                        <span className="w-1.5 h-1.5 bg-green-400 rounded-full"></span>
                        {rewards.watermarkExports} watermark-free export{rewards.watermarkExports !== 1 ? 's' : ''} available
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowWatermarkOptions(!showWatermarkOptions)}
                        className="mt-1.5 text-[9px] text-orange-400/70 hover:text-orange-400 font-mono uppercase tracking-widest text-center transition-colors"
                      >
                        Download without watermark →
                      </button>
                    )
                  )}

                  {/* Watermark removal popover */}
                  <AnimatePresence>
                    {showWatermarkOptions && tier === 'free' && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.95 }}
                        className="absolute top-full left-0 right-0 mt-2 bg-[#1a1b1e] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                      >
                        <div className="p-3 border-b border-white/5 bg-white/5">
                          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                            Remove Watermark
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="px-1.5 py-0.5 bg-black/40 border border-white/10 rounded text-[8px] font-mono text-white/60">
                              Made with PackShot
                            </div>
                            <span className="text-[9px] text-gray-600">diagonal pattern across image</span>
                          </div>
                        </div>

                        <button
                          onClick={() => { setShowWatermarkOptions(false); if (user) removeWatermark(); else createCheckout('pro'); }}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-white uppercase tracking-widest">One-time removal</span>
                            <span className="text-[9px] text-gray-500">{user ? 'Next export only' : 'Sign in required'}</span>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="text-sm font-bold text-green-400">$1</span>
                            <span className="text-[8px] text-gray-600 line-through font-mono">$2</span>
                          </div>
                        </button>

                        <button
                          onClick={() => { setShowWatermarkOptions(false); createCheckout('pro'); }}
                          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-orange-500/10 transition-colors border-b border-white/5"
                        >
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-orange-400 uppercase tracking-widest flex items-center gap-1.5">
                              <Crown className="w-3 h-3" /> Upgrade Pro
                            </span>
                            <span className="text-[9px] text-gray-500">Unlimited · all formats · no watermark</span>
                          </div>
                          <span className="text-sm font-bold text-orange-400">$19/mo</span>
                        </button>

                        {user && (
                          <div className="px-4 py-2.5 bg-white/[0.02]">
                            <p className="text-[9px] text-gray-500 text-center">
                              Or <a href="#" onClick={(e) => { e.preventDefault(); setShowWatermarkOptions(false); window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'rewards' })); }} className="text-orange-400 hover:underline">earn free credits</a> by sharing and inviting friends
                            </p>
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {showExportMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 w-48 bg-[#1a1b1e] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
                      >
                        {[
                          { id: 'tiff', label: 'TIFF', desc: 'LZW, 300 DPI' },
                          { id: 'jpeg', label: 'JPEG', desc: 'Quality 95, MozJPEG' },
                          { id: 'png', label: 'PNG', desc: 'Lossless' },
                          { id: 'webp', label: 'WebP', desc: 'Quality 95' },
                          { id: 'avif', label: 'AVIF', desc: 'Quality 80' },
                          { id: 'psd', label: 'PSD', desc: 'Photoshop, 1 layer' },
                        ].map(fmt => {
                          const locked = tier === 'free' && !FREE_FORMATS.has(fmt.id);
                          return (
                            <button
                              key={fmt.id}
                              onClick={() => {
                                if (locked) { createCheckout('pro'); return; }
                                setExportFormat(fmt.id); setShowExportMenu(false);
                              }}
                              className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${
                                locked ? 'opacity-50 cursor-not-allowed' :
                                exportFormat === fmt.id ? 'bg-orange-500/20 text-orange-400' : 'text-gray-300 hover:bg-white/5'
                              }`}
                            >
                              <span className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
                                {fmt.label}
                                {locked && <Crown className="w-3 h-3 text-orange-500" />}
                              </span>
                              <span className="text-[9px] text-gray-500">{locked ? 'Pro' : fmt.desc}</span>
                            </button>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-6">
              <div className="aspect-square rounded-2xl border-2 border-dashed border-white/10 bg-[#151619] flex items-center justify-center relative overflow-hidden shadow-2xl">
                <AnimatePresence mode="wait">
                  {isGenerating || isHomogenizing || isEditing ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center space-y-6 p-12 text-center"
                    >
                      <div className="relative">
                        <div className="w-24 h-24 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                        <Sparkles className="w-8 h-8 text-orange-500 absolute inset-0 m-auto animate-pulse" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-white font-medium">
                          {isHomogenizing ? 'Homogenizing Lighting' : isEditing ? 'Applying Targeted Edits' : generationMethod === 'ai' ? 'Technical Synthesis in Progress' : generationMethod === 'aligned-stack' ? 'Aligned Focus Stacking' : 'Quick Focus Stacking'}
                        </p>
                        <p className="text-xs text-gray-500 max-w-[200px]">
                          {isHomogenizing 
                            ? 'Balancing overexposed highlights and underexposed shadows while maintaining product fidelity.'
                            : isEditing
                            ? 'Applying your specific modifications while preserving the core product identity.'
                            : generationMethod === 'ai'
                            ? 'Enforcing strict packshot standards: Pure white background, zero artistic deviation, and exact product fidelity.'
                            : generationMethod === 'aligned-stack'
                            ? 'Non-AI mathematical algorithm: detecting features, aligning frames, computing multi-scale focus maps, and blending for a sharp, ghost-free result.'
                            : 'Non-AI mathematical algorithm: analyzing local contrast and sharpness across all frames to reconstruct a single high-depth-of-field image.'}
                        </p>
                      </div>
                    </motion.div>
                  ) : resultImage ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, scale: 1.1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full h-full p-4"
                  >
                    <canvas
                      ref={canvasRef}
                      className="w-full h-full object-contain rounded-xl shadow-2xl"
                      aria-label="Generated packshot result"
                    />
                    {isCropping && (
                      <canvas
                        ref={cropOverlayRef}
                        className="absolute inset-0 w-full h-full rounded-xl"
                        style={{ pointerEvents: 'auto' }}
                        onMouseDown={handleCropMouseDown}
                        onMouseMove={handleCropMouseMove}
                        onMouseUp={handleCropMouseUp}
                        onMouseLeave={handleCropMouseUp}
                      />
                    )}
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center space-y-4 text-gray-600">
                    <ImageIcon className="w-16 h-16 opacity-20" />
                    <p className="text-sm font-mono uppercase tracking-widest opacity-40">Awaiting Generation</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Prompt Edit Bar */}
            {resultImage && !isGenerating && !isHomogenizing && !isEditing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative group"
              >
                <div className="absolute inset-0 bg-orange-500/5 blur-xl group-hover:bg-orange-500/10 transition-all rounded-2xl" />
                <div className={`relative flex items-center bg-[#1a1b1e] border border-white/10 rounded-2xl p-2 pl-4 shadow-xl transition-all ${tier === 'free' ? 'opacity-60' : 'focus-within:border-orange-500/50'}`}>
                  <MessageSquare className="w-4 h-4 text-gray-500 mr-3" />
                  {tier === 'free' ? (
                    <div className="flex-1 flex items-center justify-between py-2">
                      <span className="text-sm text-gray-500 font-mono uppercase tracking-widest">AI Edits are for Pro users only</span>
                      <button
                        onClick={() => createCheckout('pro')}
                        className="ml-3 px-3 py-1 bg-orange-500 hover:bg-orange-600 text-white text-[10px] font-bold uppercase tracking-widest rounded-lg transition-all"
                      >
                        Upgrade
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
                        placeholder="Describe a specific change (e.g., 'Change cap color to red', 'Remove the label')..."
                        className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-white placeholder:text-gray-600 py-2"
                        aria-label="Edit prompt for targeted AI modification"
                      />
                      <button
                        onClick={handleEdit}
                        disabled={!editPrompt.trim() || isEditing}
                        className="p-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl transition-all ml-2"
                        aria-label="Send edit request"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
                <p className="mt-2 text-[9px] text-gray-500 font-mono uppercase tracking-widest text-center">
                  Targeted AI Editing • No additional creativity applied
                </p>
              </motion.div>
            )}
          </div>

            {/* Adjustments Panel */}
            {resultImage && (
              <div className="space-y-6 bg-white/[0.02] border border-white/5 rounded-2xl p-6">
                <div className="flex items-center space-x-2 text-white mb-4">
                  <SlidersHorizontal className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-bold uppercase tracking-widest">Image Adjustments</h4>
                </div>

                <div className="space-y-6">
                  {/* Gamma Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Sun className="w-3 h-3" />
                        <span>Gamma</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <AdjustmentSlider label="Background" value={adjustments.gammaBg} min={0.5} max={2} step={0.01} onChange={v => updateAdj('gammaBg', v)} />
                      <AdjustmentSlider label="Object" value={adjustments.gammaObj} min={0.5} max={2} step={0.01} onChange={v => updateAdj('gammaObj', v)} />
                    </div>
                  </div>

                  {/* RGB Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Palette className="w-3 h-3" />
                        <span>RGB Balance</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <AdjustmentSlider label="Red" value={adjustments.r} min={0.5} max={1.5} step={0.01} color="accent-red-500" onChange={v => updateAdj('r', v)} />
                      <AdjustmentSlider label="Green" value={adjustments.g} min={0.5} max={1.5} step={0.01} color="accent-green-500" onChange={v => updateAdj('g', v)} />
                      <AdjustmentSlider label="Blue" value={adjustments.b} min={0.5} max={1.5} step={0.01} color="accent-blue-500" onChange={v => updateAdj('b', v)} />
                    </div>
                  </div>

                  {/* Effects Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Zap className="w-3 h-3" />
                        <span>Vibrance</span>
                      </div>
                    </div>
                    <AdjustmentSlider label="Intensity" value={adjustments.vibrance} min={-1} max={1} step={0.01} onChange={v => updateAdj('vibrance', v)} />
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Target className="w-3 h-3" />
                        <span>Sharpen</span>
                      </div>
                    </div>
                    <AdjustmentSlider label="Detail" value={adjustments.sharpen} min={0} max={1} step={0.01} onChange={v => updateAdj('sharpen', v)} />
                  </div>
                </div>

                <button 
                  onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                  className="w-full mt-6 py-2 text-[10px] font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors border border-white/5 hover:border-white/10 rounded-lg"
                >
                  Reset Adjustments
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center space-x-3">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>

      {/* Auth modal shown when anonymous user tries to generate */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        defaultTab="register"
      />
    </div>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color?: string;
  onChange: (val: number) => void;
}

const AdjustmentSlider: React.FC<SliderProps> = ({ label, value, min, max, step, color = "accent-orange-500", onChange }) => {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[9px] font-mono text-gray-400">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input 
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer ${color}`}
      />
    </div>
  );
};
