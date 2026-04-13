/**
 * Studio REST API v1 — headless endpoints for automation.
 * All endpoints require API key auth (Studio tier only).
 * Rate limited to 100 req/min per API key.
 */

import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { apiKeyAuth } from './api-auth.js';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { checkQuota, checkExportFormat, getMaxResolution } from '../tier/limits.js';
import { checkAICredits, getAIProvider } from '../credits/ai-credits.js';
import { performFocusStack } from '../focus-stack.js';
import { fireWebhook } from './webhooks.js';

const router = Router();

// Rate limit: 100 req/min per API key
const v1Limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  keyGenerator: (req) => {
    // Use API key hash as rate limit key
    const auth = req.headers.authorization || '';
    return auth.slice(0, 30); // Use prefix as key identifier
  },
  message: { error: 'Rate limit exceeded (100 req/min)', code: 'RATE_LIMITED' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply API key auth + rate limit to all v1 routes
router.use(apiKeyAuth, v1Limiter);

// Multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads');
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024, files: 50 } });

/**
 * POST /api/v1/process — Upload RAW/PSD, get base64 preview.
 * Accepts multipart/form-data with "file" field.
 * Returns: { image: { name, base64, mimeType } }
 */
router.post('/process', checkQuota, (req: AuthenticatedRequest, res: Response, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: `Upload error: ${err.message}` });
    next();
  });
}, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = `job_${Date.now()}`;
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const buffer = fs.readFileSync(file.path);
    const maxRes = getMaxResolution(req);

    // Process with Sharp (simplified for API — no libraw for now, accepts pre-decoded)
    const optimized = await sharp(buffer)
      .rotate()
      .resize(maxRes, maxRes, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    // Clean up temp file
    try { fs.unlinkSync(file.path); } catch {}

    const result = {
      name: file.originalname,
      base64: optimized.toString('base64'),
      mimeType: 'image/jpeg',
    };

    // Fire webhook
    fireWebhook(req.user!.id, 'job.completed', { jobId, type: 'process', file: file.originalname });

    res.json({ image: result, jobId });
  } catch (error: any) {
    fireWebhook(req.user!.id, 'job.failed', { jobId, type: 'process', error: error.message });
    res.status(500).json({ error: error.message || 'Processing failed', jobId });
  }
});

/**
 * POST /api/v1/stack — Aligned focus stack.
 * Body: { images: [{ base64, mimeType }], options?: {} }
 * Returns: focus stack result with diagnostics.
 */
router.post('/stack', checkQuota, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = `job_${Date.now()}`;
  try {
    const { images, options } = req.body;

    if (!images || !Array.isArray(images) || images.length < 2) {
      return res.status(400).json({ error: 'At least 2 images required', code: 'INSUFFICIENT_IMAGES' });
    }

    if (images.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 images for Studio tier', code: 'TOO_MANY_IMAGES' });
    }

    const result = await performFocusStack(images, options);

    fireWebhook(req.user!.id, 'job.completed', { jobId, type: 'stack', imageCount: images.length });

    res.json({ ...result, jobId });
  } catch (error: any) {
    fireWebhook(req.user!.id, 'job.failed', { jobId, type: 'stack', error: error.message });
    res.status(500).json({ error: error.message || 'Focus stacking failed', jobId });
  }
});

/**
 * POST /api/v1/export — Convert image format.
 * Body: { imageBase64: string, format: 'tiff'|'jpeg'|'png'|'webp'|'avif'|'psd' }
 * Returns: base64 of converted image.
 */
router.post('/export', checkExportFormat, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { imageBase64, format = 'tiff' } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'No image data provided' });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    let outputBuffer: Buffer;
    let mimeType: string;

    switch (format) {
      case 'jpeg':
        outputBuffer = await sharp(buffer).jpeg({ quality: 95, mozjpeg: true }).toBuffer();
        mimeType = 'image/jpeg';
        break;
      case 'png':
        outputBuffer = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
        mimeType = 'image/png';
        break;
      case 'webp':
        outputBuffer = await sharp(buffer).webp({ quality: 95 }).toBuffer();
        mimeType = 'image/webp';
        break;
      case 'avif':
        outputBuffer = await sharp(buffer).avif({ quality: 80 }).toBuffer();
        mimeType = 'image/avif';
        break;
      case 'tiff':
      default:
        outputBuffer = await sharp(buffer).tiff({ compression: 'lzw', xres: 300, yres: 300 }).toBuffer();
        mimeType = 'image/tiff';
        break;
    }

    // Return as base64 (JSON API, not binary download)
    res.json({
      base64: outputBuffer.toString('base64'),
      mimeType,
      format,
      size: outputBuffer.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Export failed' });
  }
});

/**
 * POST /api/v1/ai/generate — AI packshot generation.
 * Body: { images: [{ base64, mimeType }], provider?: string }
 * Returns: { image: "data:image/png;base64,..." }
 */
router.post('/ai/generate', checkAICredits, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = `job_${Date.now()}`;
  try {
    const { images } = req.body;
    if (!images?.length) return res.status(400).json({ error: 'No images provided' });

    const provider = getAIProvider(req);
    if (!provider) {
      return res.status(500).json({ error: 'No AI provider available' });
    }

    const result = await provider.generatePackshot(images);

    fireWebhook(req.user!.id, 'job.completed', {
      jobId,
      type: 'ai.generate',
      provider: (req as any)._aiProviderName,
    });

    res.json({ ...result, jobId, provider: (req as any)._aiProviderName });
  } catch (error: any) {
    fireWebhook(req.user!.id, 'job.failed', { jobId, type: 'ai.generate', error: error.message });
    res.status(500).json({ error: error.message || 'AI generation failed', jobId });
  }
});

/**
 * POST /api/v1/ai/homogenize — AI lighting correction.
 * Body: { currentImage, sourceImages, burnt?, dark?, provider? }
 */
router.post('/ai/homogenize', checkAICredits, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = `job_${Date.now()}`;
  try {
    const { currentImage, sourceImages, burnt = 15, dark = 15 } = req.body;
    if (!currentImage || !sourceImages?.length) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const provider = getAIProvider(req);
    if (!provider) return res.status(500).json({ error: 'No AI provider available' });

    const result = await provider.homogenize(currentImage, sourceImages, burnt, dark);

    fireWebhook(req.user!.id, 'job.completed', { jobId, type: 'ai.homogenize' });

    res.json({ ...result, jobId });
  } catch (error: any) {
    fireWebhook(req.user!.id, 'job.failed', { jobId, type: 'ai.homogenize', error: error.message });
    res.status(500).json({ error: error.message || 'Homogenization failed', jobId });
  }
});

/**
 * POST /api/v1/ai/edit — AI targeted edit.
 * Body: { currentImage, sourceImages?, prompt, provider? }
 */
router.post('/ai/edit', checkAICredits, async (req: AuthenticatedRequest, res: Response) => {
  const jobId = `job_${Date.now()}`;
  try {
    const { currentImage, sourceImages, prompt } = req.body;
    if (!currentImage || !prompt) {
      return res.status(400).json({ error: 'Missing image or prompt' });
    }

    const provider = getAIProvider(req);
    if (!provider) return res.status(500).json({ error: 'No AI provider available' });

    const result = await provider.editImage(currentImage, sourceImages || [], prompt);

    fireWebhook(req.user!.id, 'job.completed', { jobId, type: 'ai.edit' });

    res.json({ ...result, jobId });
  } catch (error: any) {
    fireWebhook(req.user!.id, 'job.failed', { jobId, type: 'ai.edit', error: error.message });
    res.status(500).json({ error: error.message || 'Edit failed', jobId });
  }
});

export { router as v1Router };
