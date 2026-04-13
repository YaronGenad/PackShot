/**
 * Express backend — handles RAW/PSD upload/extraction, focus stacking, multi-format export,
 * and proxies Gemini API calls so API keys never reach the client bundle.
 */

// Load .env before any other imports so env vars are available everywhere
import 'dotenv/config';

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pino from "pino";
import sharp from "sharp";
import cookieParser from "cookie-parser";
// @ts-ignore — librawspeed types declare module as "libraw"
import LibRaw from "librawspeed";
// GoogleGenAI now used via ai-providers/gemini.ts adapter
import { readPsd, writePsdBuffer, initializeCanvas } from "ag-psd";
import { performFocusStack } from "./src/lib/focus-stack.js";
import { authRouter } from "./src/lib/auth/routes.js";
import { billingRouter } from "./src/lib/billing/routes.js";
import { optionalAuth, getEffectiveTier, AuthenticatedRequest } from "./src/lib/auth/middleware.js";
import { checkQuota, checkExportFormat, getMaxResolution, getMaxUploadFiles, TIER_LIMITS } from "./src/lib/tier/limits.js";
import { consumeWatermarkExport, grantReward } from "./src/lib/rewards/rewards.js";
import { initWatermark, applyWatermark } from "./src/lib/tier/watermark.js";
import { creditsRouter } from "./src/lib/credits/routes.js";
import { rewardsRouter } from "./src/lib/rewards/routes.js";
import { checkAICredits, getAIProvider } from "./src/lib/credits/ai-credits.js";
import { apiKeysRouter } from "./src/lib/studio-api/api-keys.js";
import { v1Router } from "./src/lib/studio-api/v1-routes.js";
import { webhooksRouter } from "./src/lib/studio-api/webhooks.js";

/** Structured logger — JSON output, request tracking. */
const log = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

/** Initialize ag-psd for Node.js — canvas factory that stores pixel data in memory. */
initializeCanvas(
  (w: number, h: number) => {
    const pixelData = new Uint8ClampedArray(w * h * 4);
    return {
      width: w, height: h,
      getContext: () => ({
        canvas: { width: w, height: h },
        createImageData: (w2: number, h2: number) => ({ width: w2, height: h2, data: new Uint8ClampedArray(w2 * h2 * 4) }),
        putImageData: (imgData: any, dx: number, dy: number) => {
          // Copy pixel data into our backing store
          const src = imgData.data;
          const srcW = imgData.width;
          for (let y = 0; y < imgData.height; y++) {
            const srcOff = y * srcW * 4;
            const dstOff = ((y + dy) * w + dx) * 4;
            pixelData.set(src.subarray(srcOff, srcOff + srcW * 4), dstOff);
          }
        },
        getImageData: (_x: number, _y: number, w2: number, h2: number) => ({ width: w2, height: h2, data: pixelData }),
      }),
    } as any;
  },
  ((w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4), colorSpace: 'srgb' as const })) as any
);

/** All RAW extensions supported by librawspeed (1181+ cameras). */
const RAW_EXTENSIONS = new Set([
  '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.dng', '.raf', '.orf', '.rw2', '.rwl', '.pef', '.ptx',
  '.srw', '.x3f', '.3fr', '.fff', '.iiq', '.mrw', '.mef',
  '.mos', '.kdc', '.dcr', '.raw', '.rwz', '.erf', '.bay',
]);

// Disable sharp cache to save memory in constrained environments
sharp.cache(false);
sharp.concurrency(1);

/** File magic bytes for validation — reject spoofed extensions. */
const MAGIC_BYTES: Record<string, Buffer[]> = {
  jpeg: [Buffer.from([0xFF, 0xD8])],
  png: [Buffer.from([0x89, 0x50, 0x4E, 0x47])],
  tiff: [Buffer.from([0x49, 0x49, 0x2A, 0x00]), Buffer.from([0x4D, 0x4D, 0x00, 0x2A])], // Little/big endian
  psd: [Buffer.from([0x38, 0x42, 0x50, 0x53])], // "8BPS"
  riff: [Buffer.from([0x52, 0x49, 0x46, 0x46])], // RIFF container (some RAW formats)
};

/** Validate that file content matches expected format based on magic bytes. */
function validateFileMagic(buffer: Buffer, ext: string): boolean {
  // RAW formats use TIFF container (CR2, NEF, ARW, DNG, ORF, PEF, etc.)
  if (RAW_EXTENSIONS.has(ext)) {
    const hasTiff = MAGIC_BYTES.tiff.some(m => buffer.subarray(0, m.length).equals(m));
    const hasRiff = MAGIC_BYTES.riff.some(m => buffer.subarray(0, m.length).equals(m));
    const hasFuji = buffer.subarray(0, 8).toString('ascii').startsWith('FUJIFILM'); // RAF
    const hasPana = buffer.length > 20; // RW2 has various headers — trust extension for Panasonic
    return hasTiff || hasRiff || hasFuji || hasPana;
  }
  if (ext === '.psd' || ext === '.psb') {
    return MAGIC_BYTES.psd.some(m => buffer.subarray(0, m.length).equals(m));
  }
  return true; // Unknown extension — let Sharp try to decode
}

log.info('Server starting');

async function startServer() {
  try {
    // Initialize watermark PNG for Free tier exports
    await initWatermark();
    log.info('Watermark initialized');

    const app = express();
    const PORT = 3000;

  // Security headers — relaxed CSP in dev for Vite HMR, strict in production
  const isDev = process.env.NODE_ENV !== 'production';
  app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: isDev ? false : {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
  }));

  // CORS — restrict to explicit origins in production
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  }));

  // Cookie parser — needed for auth token cookies
  app.use(cookieParser());

  // PayPal webhook needs raw body for signature verification — mount BEFORE json parser
  app.post('/api/billing/webhook', express.raw({ type: 'application/json' }));

  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Rate limiting
  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
  const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Upload rate limit exceeded' } });
  const stackLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Processing rate limit exceeded' } });
  app.use('/api', apiLimiter);

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      log.info({ method: req.method, url: req.url, status: res.statusCode, ms: Date.now() - start }, 'request');
    });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // ── Auth, Billing, Credits & Studio API routes ───────────────────────
  app.use('/api/auth', authRouter);
  app.use('/api/billing', billingRouter);
  app.use('/api/credits', creditsRouter);
  app.use('/api/rewards', rewardsRouter);
  app.use('/api/api-keys', apiKeysRouter);
  app.use('/api/v1', v1Router);
  app.use('/api/settings/webhooks', webhooksRouter);

  // Health check
  app.get("/api/ping", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Tier limits — returns limits for the current user's tier
  app.get("/api/tier/limits", optionalAuth, (req: AuthenticatedRequest, res) => {
    const tier = getEffectiveTier(req);
    res.json({ tier, limits: TIER_LIMITS[tier] });
  });

  const uploadDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  });

  /** Create multer instance with dynamic file limit based on user tier. */
  function createUpload(maxFiles: number) {
    return multer({
      storage,
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB per file
        files: maxFiles,
      },
    });
  }

  // Extract preview from any RAW format via librawspeed, fallback to Sharp for non-RAW
  // No quota check here — this is just input extraction, quota is charged on focus-stack/generate
  app.post("/api/process-raw", uploadLimiter, optionalAuth, (req: AuthenticatedRequest, res, next) => {
    log.debug('Processing /api/process-raw request');
    const maxFiles = getMaxUploadFiles(req);
    const upload = createUpload(maxFiles);
    upload.single("images")(req, res, (err) => {
      if (err) {
        log.error({ err }, 'Multer error');
        return res.status(400).json({
          error: `Upload error: ${err.message}`,
          code: err.code
        });
      }
      log.debug({ file: req.file?.originalname }, 'File received');
      next();
    });
  }, async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const processedImages: any[] = [];
      const filePath = file.path;
      const ext = path.extname(file.originalname).toLowerCase();
      const isRAW = RAW_EXTENSIONS.has(ext);
      const isPSD = ext === '.psd' || ext === '.psb';
      log.info({ file: file.originalname, size: file.size, isRAW, isPSD }, 'Processing file');

      try {
        const buffer = fs.readFileSync(filePath);

        // Validate file magic bytes match claimed extension
        if (!validateFileMagic(buffer, ext)) {
          throw new Error(`File content doesn't match extension ${ext}. Possible corrupted or spoofed file.`);
        }

        let previewBuffer: Buffer | null = null;

        // PSD: read composite or flatten layers into JPEG via ag-psd + Sharp
        if (isPSD) {
          try {
            const psd = readPsd(buffer, { useImageData: true, skipLayerImageData: true });
            if (psd.imageData) {
              // Composite image — convert RGBA pixels to JPEG via Sharp
              previewBuffer = await sharp(Buffer.from(psd.imageData.data.buffer), {
                raw: { width: psd.imageData.width, height: psd.imageData.height, channels: 4 },
              }).jpeg({ quality: 90 }).toBuffer();
              log.info(`[PSD COMPOSITE] Success for ${file.originalname}, size: ${previewBuffer.length}`);
            } else {
              // No composite — try first layer with pixel data
              const psd2 = readPsd(buffer, { useImageData: true, skipCompositeImageData: true });
              const layer = psd2.children?.find((c: any) => c.imageData);
              if (layer?.imageData) {
                previewBuffer = await sharp(Buffer.from(layer.imageData.data.buffer), {
                  raw: { width: layer.imageData.width, height: layer.imageData.height, channels: 4 },
                }).jpeg({ quality: 90 }).toBuffer();
                log.info(`[PSD LAYER] Success from layer "${layer.name}" for ${file.originalname}`);
              }
            }
          } catch (e: any) {
            log.info(`[PSD] Failed for ${file.originalname}: ${e.message}`);
          }
        }

        // RAW: extract via librawspeed (thumbnail first, then full decode)
        if (!previewBuffer && isRAW) {
          // Strategy 1: LibRaw embedded thumbnail extraction (fast, preserves camera JPEG)
          const lr = new LibRaw();
          try {
            await lr.loadBuffer(buffer);
            const thumbResult = await lr.createThumbnailJPEGBuffer();
            if (thumbResult?.success && thumbResult.buffer?.length > 10000) {
              previewBuffer = thumbResult.buffer;
              log.info(`[LIBRAW THUMB] Success for ${file.originalname}, size: ${previewBuffer.length}`);
            }
          } catch (e: any) {
            log.info(`[LIBRAW THUMB] Failed for ${file.originalname}: ${e.message}`);
          }

          // Strategy 2: LibRaw full RAW decode to JPEG (slower but works if no embedded thumb)
          if (!previewBuffer) {
            try {
              await lr.processImage();
              const jpegResult = await lr.createJPEGBuffer({ quality: 90 });
              if (jpegResult?.success && jpegResult.buffer?.length > 10000) {
                previewBuffer = jpegResult.buffer;
                log.info(`[LIBRAW DECODE] Success for ${file.originalname}, size: ${previewBuffer.length}`);
              }
            } catch (e: any) {
              log.info(`[LIBRAW DECODE] Failed for ${file.originalname}: ${e.message}`);
            }
          }
          lr.close();
        }

        // Strategy 3: Sharp direct decode (for non-RAW or as last resort)
        if (!previewBuffer) {
          try {
            previewBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
            log.info(`[SHARP] Direct decode success for ${file.originalname}, size: ${previewBuffer.length}`);
          } catch (e: any) {
            log.info(`[SHARP] Direct decode failed for ${file.originalname}: ${e.message}`);
          }
        }

        if (!previewBuffer) {
          throw new Error("Could not extract preview. File may be corrupted or unsupported.");
        }

        // Optimize: auto-rotate, resize (tier-based), compress
        const maxRes = getMaxResolution(req as AuthenticatedRequest);
        const optimized = await sharp(previewBuffer)
          .rotate()
          .resize(maxRes, maxRes, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();

        log.info(`Optimized ${file.originalname}: ${previewBuffer.length} → ${optimized.length} bytes`);

        processedImages.push({
          name: file.originalname,
          base64: optimized.toString("base64"),
          mimeType: "image/jpeg"
        });
      } catch (err: any) {
        log.error({ err, file: file.originalname }, 'Error processing file');
        processedImages.push({
          name: file.originalname,
          error: err.message || "Failed to process file"
        });
      } finally {
        if (fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }

      const success = processedImages.length > 0 && !processedImages[0].error;
      if (!success) {
        return res.status(422).json({
          error: processedImages[0]?.error || "Failed to process file",
          images: processedImages
        });
      }
      res.json({ images: processedImages });
    } catch (error: any) {
      log.error({ err: error }, 'Processing error');
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error during processing", details: error.message });
      }
    }
  });

  // Export final image in multiple formats — TIFF, JPEG, PNG, WebP, AVIF, HEIC
  app.post("/api/export", optionalAuth, checkExportFormat, async (req: AuthenticatedRequest, res) => {
    try {
      const { imageBase64, format = 'tiff' } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "No image data provided" });
      }

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');
      const timestamp = Date.now();

      let outputBuffer: Buffer;
      let contentType: string;
      let extension: string;

      switch (format) {
        case 'jpeg':
          outputBuffer = await sharp(buffer).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
          contentType = 'image/jpeg';
          extension = 'jpg';
          break;
        case 'png':
          outputBuffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
          contentType = 'image/png';
          extension = 'png';
          break;
        case 'webp':
          outputBuffer = await sharp(buffer).webp({ quality: 95, lossless: false }).toBuffer();
          contentType = 'image/webp';
          extension = 'webp';
          break;
        case 'avif':
          outputBuffer = await sharp(buffer).avif({ quality: 80 }).toBuffer();
          contentType = 'image/avif';
          extension = 'avif';
          break;
        case 'psd': {
          // Decode PNG to raw RGBA pixels, then write as PSD with one layer
          const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
          const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
          const psd = {
            width: info.width,
            height: info.height,
            channels: 4 as 4,
            colorMode: 3, // RGB
            children: [{
              name: 'Packshot',
              top: 0, left: 0, bottom: info.height, right: info.width,
              imageData: { width: info.width, height: info.height, data: pixels },
            }],
            imageData: { width: info.width, height: info.height, data: pixels },
          };
          outputBuffer = writePsdBuffer(psd) as Buffer;
          contentType = 'application/x-photoshop';
          extension = 'psd';
          break;
        }
        case 'tiff':
        default:
          outputBuffer = await sharp(buffer)
            .tiff({ compression: 'lzw', predictor: 'horizontal', xres: 300, yres: 300 })
            .toBuffer();
          contentType = 'image/tiff';
          extension = 'tiff';
          break;
      }

      // Apply watermark for Free tier users — only consume credit if user explicitly opted in
      const tier = getEffectiveTier(req);
      const userWantsCredit = req.body.useWatermarkCredit === true;
      let shouldWatermark = TIER_LIMITS[tier].watermark && format !== 'psd';
      if (shouldWatermark && req.user && userWantsCredit) {
        const consumed = await consumeWatermarkExport(req.user.id);
        if (consumed) {
          shouldWatermark = false;
          log.info({ userId: req.user.id }, 'Watermark credit consumed (user opted in)');
        }
      }
      if (shouldWatermark) {
        try {
          outputBuffer = await applyWatermark(outputBuffer);
        } catch (wmErr: any) {
          log.warn({ err: wmErr }, 'Watermark application failed, exporting without');
        }
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=packshot-${timestamp}.${extension}`);
      res.send(outputBuffer);
    } catch (error: any) {
      log.error({ err: error, format: req.body?.format }, 'Export error');
      res.status(500).json({ error: `Failed to export as ${req.body?.format || 'tiff'}`, details: error.message });
    }
  });

  // Legacy endpoint — redirect to new /api/export
  app.post("/api/convert-to-tiff", async (req, res) => {
    req.body.format = 'tiff';
    res.redirect(307, '/api/export');
  });

  // Deterministic focus stacking — OpenCV alignment + multi-scale compositing, no LLM
  app.post("/api/focus-stack", stackLimiter, optionalAuth, checkQuota, async (req: AuthenticatedRequest, res) => {
    const startTime = Date.now();
    try {
      const { images, options } = req.body;

      if (!images || !Array.isArray(images) || images.length < 2) {
        return res.status(400).json({
          error: "At least 2 images required for focus stacking",
          code: "INSUFFICIENT_IMAGES",
        });
      }

      if (images.length > 10) {
        return res.status(400).json({
          error: "Maximum 10 images supported",
          code: "PROCESSING_ERROR",
        });
      }

      log.info({ imageCount: images.length, options: options || 'defaults' }, 'Focus stack starting');
      const result = await performFocusStack(images, options);
      log.info(`[focus-stack] Done in ${Date.now() - startTime}ms`);

      res.json(result);
    } catch (error: any) {
      log.error({ err: error }, 'Focus stack error');
      if (!res.headersSent) {
        res.status(500).json({
          error: error.message || "Focus stacking failed",
          code: "PROCESSING_ERROR",
        });
      }
    }
  });

  // ── AI provider info ──────────────────────────────────────────────────

  /** List available AI providers and which the user has BYOK keys for. */
  app.get("/api/ai/providers", optionalAuth, async (req: AuthenticatedRequest, res) => {
    const { PROVIDER_INFO } = await import('./src/lib/ai-providers/registry.js');
    const providers = Object.entries(PROVIDER_INFO).map(([id, info]) => ({
      id,
      ...info,
    }));
    res.json({ providers, default: 'gemini' });
  });

  // ── AI proxy endpoints — multi-provider via adapter pattern ─────────

  /**
   * Fallback: get a Gemini provider using server env key
   * when checkAICredits middleware hasn't resolved a provider.
   */
  const getFallbackProvider = () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not configured. Set GEMINI_API_KEY env var.');
    const { GeminiProvider } = require('./src/lib/ai-providers/gemini.js');
    return new GeminiProvider(key);
  };

  /** Generate studio packshot — uses resolved provider from checkAICredits. */
  app.post("/api/generate-packshot", stackLimiter, optionalAuth, checkAICredits, async (req: AuthenticatedRequest, res) => {
    try {
      const { images } = req.body;
      if (!images?.length) return res.status(400).json({ error: 'No images provided' });

      const provider = getAIProvider(req) || getFallbackProvider();
      const result = await provider.generatePackshot(images);

      res.json(result);
    } catch (error: any) {
      log.error({ err: error, provider: (req as any)._aiProviderName }, 'Generate packshot error');
      const status = error.message?.includes('API_KEY') || error.message?.includes('not found') ? 401 : 500;
      res.status(status).json({ error: error.message || 'Generation failed' });
    }
  });

  /** Homogenize lighting — uses resolved provider. */
  app.post("/api/homogenize", stackLimiter, optionalAuth, checkAICredits, async (req: AuthenticatedRequest, res) => {
    try {
      const { currentImage, sourceImages, burnt = 15, dark = 15 } = req.body;
      if (!currentImage || !sourceImages?.length) return res.status(400).json({ error: 'Missing image data' });

      const provider = getAIProvider(req) || getFallbackProvider();
      const result = await provider.homogenize(currentImage, sourceImages, burnt, dark);

      res.json(result);
    } catch (error: any) {
      log.error({ err: error, provider: (req as any)._aiProviderName }, 'Homogenize error');
      res.status(500).json({ error: error.message || 'Homogenization failed' });
    }
  });

  /** Targeted edit via user prompt — uses resolved provider. */
  app.post("/api/edit-packshot", stackLimiter, optionalAuth, checkAICredits, async (req: AuthenticatedRequest, res) => {
    try {
      const { currentImage, sourceImages, prompt } = req.body;
      if (!currentImage || !prompt) return res.status(400).json({ error: 'Missing image or prompt' });

      const provider = getAIProvider(req) || getFallbackProvider();
      const result = await provider.editImage(currentImage, sourceImages || [], prompt);

      res.json(result);
    } catch (error: any) {
      log.error({ err: error, provider: (req as any)._aiProviderName }, 'Edit packshot error');
      res.status(500).json({ error: error.message || 'Edit failed' });
    }
  });

  // API Catch-all
  app.all("/api/*", (req, res) => {
    log.info(`404 API Route: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    log.error({ err }, 'Unhandled server error');
    res.status(500).json({ 
      error: "Internal server error", 
      message: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    log.info(`Server running on http://localhost:${PORT}`);
  });

  // Graceful shutdown — drain connections before exiting
  const shutdown = (signal: string) => {
    log.info(`${signal} received — shutting down gracefully`);
    server.close(() => {
      log.info('All connections drained, exiting');
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      log.warn('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (e) {
    log.error({ err: e }, 'Server startup error');
    process.exit(1);
  }
}

startServer().catch(err => {
  log.error({ err }, 'Failed to start server');
  process.exit(1);
});
