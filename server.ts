/**
 * Express backend — handles RAW/PSD upload/extraction, focus stacking, and multi-format export.
 * API routes: /api/process-raw, /api/focus-stack, /api/export.
 */

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import sharp from "sharp";
// @ts-ignore — librawspeed types declare module as "libraw"
import LibRaw from "librawspeed";
import { readPsd, writePsdBuffer, initializeCanvas } from "ag-psd";
import { performFocusStack } from "./src/lib/focus-stack.js";

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

console.log("SERVER STARTING AT", new Date().toISOString());

async function startServer() {
  try {
    const app = express();
    const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));
  
  // Logging middleware
  app.use((req, res, next) => {
    const contentLength = req.headers['content-length'];
    const sizeStr = contentLength ? ` (${(parseInt(contentLength) / (1024 * 1024)).toFixed(2)} MB)` : '';
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}${sizeStr}`);
    
    // Prevent caching of API responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    next();
  });

  // API Ping
  app.get("/api/ping", (req, res) => {
    console.log("Ping received");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
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

  const upload = multer({ 
    storage: storage,
    limits: { 
      fileSize: 100 * 1024 * 1024, // 100MB per file
      files: 10 // Max 10 files at once
    }
  });

  // Extract preview from any RAW format via librawspeed, fallback to Sharp for non-RAW
  app.post("/api/process-raw", (req, res, next) => {
    console.log("Processing /api/process-raw request...");
    upload.single("images")(req, res, (err) => {
      if (err) {
        console.error("Multer error:", err);
        return res.status(400).json({
          error: `Upload error: ${err.message}`,
          code: err.code
        });
      }
      console.log("File received:", req.file ? req.file.originalname : "none");
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
      console.log(`Processing file: ${file.originalname}, size: ${file.size} bytes, RAW: ${isRAW}, PSD: ${isPSD}`);

      try {
        const buffer = fs.readFileSync(filePath);
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
              console.log(`[PSD COMPOSITE] Success for ${file.originalname}, size: ${previewBuffer.length}`);
            } else {
              // No composite — try first layer with pixel data
              const psd2 = readPsd(buffer, { useImageData: true, skipCompositeImageData: true });
              const layer = psd2.children?.find((c: any) => c.imageData);
              if (layer?.imageData) {
                previewBuffer = await sharp(Buffer.from(layer.imageData.data.buffer), {
                  raw: { width: layer.imageData.width, height: layer.imageData.height, channels: 4 },
                }).jpeg({ quality: 90 }).toBuffer();
                console.log(`[PSD LAYER] Success from layer "${layer.name}" for ${file.originalname}`);
              }
            }
          } catch (e: any) {
            console.log(`[PSD] Failed for ${file.originalname}: ${e.message}`);
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
              console.log(`[LIBRAW THUMB] Success for ${file.originalname}, size: ${previewBuffer.length}`);
            }
          } catch (e: any) {
            console.log(`[LIBRAW THUMB] Failed for ${file.originalname}: ${e.message}`);
          }

          // Strategy 2: LibRaw full RAW decode to JPEG (slower but works if no embedded thumb)
          if (!previewBuffer) {
            try {
              await lr.processImage();
              const jpegResult = await lr.createJPEGBuffer({ quality: 90 });
              if (jpegResult?.success && jpegResult.buffer?.length > 10000) {
                previewBuffer = jpegResult.buffer;
                console.log(`[LIBRAW DECODE] Success for ${file.originalname}, size: ${previewBuffer.length}`);
              }
            } catch (e: any) {
              console.log(`[LIBRAW DECODE] Failed for ${file.originalname}: ${e.message}`);
            }
          }
          lr.close();
        }

        // Strategy 3: Sharp direct decode (for non-RAW or as last resort)
        if (!previewBuffer) {
          try {
            previewBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
            console.log(`[SHARP] Direct decode success for ${file.originalname}, size: ${previewBuffer.length}`);
          } catch (e: any) {
            console.log(`[SHARP] Direct decode failed for ${file.originalname}: ${e.message}`);
          }
        }

        if (!previewBuffer) {
          throw new Error("Could not extract preview. File may be corrupted or unsupported.");
        }

        // Optimize: auto-rotate, resize, compress
        const optimized = await sharp(previewBuffer)
          .rotate()
          .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();

        console.log(`Optimized ${file.originalname}: ${previewBuffer.length} → ${optimized.length} bytes`);

        processedImages.push({
          name: file.originalname,
          base64: optimized.toString("base64"),
          mimeType: "image/jpeg"
        });
      } catch (err: any) {
        console.error(`Error processing ${file.originalname}:`, err);
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
      console.error("Processing error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error during processing", details: error.message });
      }
    }
  });

  // Export final image in multiple formats — TIFF, JPEG, PNG, WebP, AVIF, HEIC
  app.post("/api/export", async (req, res) => {
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

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename=packshot-${timestamp}.${extension}`);
      res.send(outputBuffer);
    } catch (error: any) {
      console.error(`Export error (${req.body?.format}):`, error);
      res.status(500).json({ error: `Failed to export as ${req.body?.format || 'tiff'}`, details: error.message });
    }
  });

  // Legacy endpoint — redirect to new /api/export
  app.post("/api/convert-to-tiff", async (req, res) => {
    req.body.format = 'tiff';
    res.redirect(307, '/api/export');
  });

  // Deterministic focus stacking — OpenCV alignment + multi-scale compositing, no LLM
  app.post("/api/focus-stack", async (req, res) => {
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

      console.log(`[focus-stack] Starting with ${images.length} images, options:`, options || 'defaults');
      const result = await performFocusStack(images, options);
      console.log(`[focus-stack] Done in ${Date.now() - startTime}ms`);

      res.json(result);
    } catch (error: any) {
      console.error("[focus-stack] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          error: error.message || "Focus stacking failed",
          code: "PROCESSING_ERROR",
        });
      }
    }
  });

  // API Catch-all
  app.all("/api/*", (req, res) => {
    console.log(`404 API Route: ${req.method} ${req.url}`);
    res.status(404).json({ error: `API route not found: ${req.method} ${req.url}` });
  });

  // Global Error Handler
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("GLOBAL SERVER ERROR:", err);
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  } catch (e) {
    console.error("SERVER STARTUP ERROR:", e);
    process.exit(1);
  }
}

startServer().catch(err => {
  console.error("FAILED TO START SERVER:", err);
  process.exit(1);
});
