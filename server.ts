import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import cors from "cors";
import sharp from "sharp";
import exifParser from "exif-parser";
import { performFocusStack } from "./src/lib/focus-stack.js";

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

  // API Route to process CR2
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

      const processedImages = [];
      const filePath = file.path;
      console.log(`Processing file: ${file.originalname}, size: ${file.size} bytes`);
      
      try {
        const buffer = fs.readFileSync(filePath);
        let previewBuffer: Buffer | null = null;
        // Robust extension check
        const ext = path.extname(file.originalname).toLowerCase();
        const isCR2 = ext === '.cr2';
        
        console.log(`[PROCESS] File: ${file.originalname}, Size: ${buffer.length} bytes, isCR2: ${isCR2}`);

        // Strategy 1: Use exif-parser (Best for CR2)
        if (isCR2) {
          try {
            const parser = exifParser.create(buffer);
            const result = parser.parse();
            previewBuffer = result.getThumbnailBuffer();
            if (previewBuffer && previewBuffer.length > 10000) {
              console.log(`[STRATEGY 1] Exif-parser success for ${file.originalname}, size: ${previewBuffer.length}`);
            } else {
              console.log(`[STRATEGY 1] Exif-parser returned no or too small thumbnail for ${file.originalname}`);
              previewBuffer = null; // Reset if too small
            }
          } catch (e) {
            console.log(`[STRATEGY 1] Exif-parser failed for ${file.originalname}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Strategy 2: Try sharp directly (ONLY if not CR2, as CR2 direct processing is known to fail with tiff2vips error)
        if (!previewBuffer && !isCR2) {
          try {
            previewBuffer = await sharp(buffer).toBuffer();
            console.log(`[STRATEGY 2] Sharp direct success for ${file.originalname}`);
          } catch (e: any) {
            console.log(`[STRATEGY 2] Sharp direct failed for ${file.originalname}: ${e.message}`);
          }
        }

        // Strategy 3: Manual JPEG extraction (Fallback for CR2 or others)
        if (!previewBuffer) {
          console.log(`[STRATEGY 3] Attempting manual JPEG extraction for ${file.originalname}...`);
          let bestPreview: Buffer | null = null;
          let searchIdx = 0;
          const maxSearches = 1000; // Increased search limit
          let searches = 0;

          // Search for JPEG markers FF D8 ... FF D9
          while (searches < maxSearches) {
            const startIdx = buffer.indexOf(Buffer.from([0xff, 0xd8]), searchIdx);
            if (startIdx === -1) break;
            
            // Look for the end of the JPEG
            // We search for FF D9, but we need to be careful about false positives
            // A real JPEG usually has a SOI (FF D8) followed by an APP marker (FF E0-EF) or COM (FF FE) or DQT (FF DB)
            const nextByte = buffer[startIdx + 2];
            if (nextByte !== 0xff) {
              searchIdx = startIdx + 2;
              continue;
            }

            const endIdx = buffer.indexOf(Buffer.from([0xff, 0xd9]), startIdx + 2);
            if (endIdx === -1) {
              searchIdx = startIdx + 2;
              continue;
            }
            
            const currentPreview = buffer.slice(startIdx, endIdx + 2);
            
            // Validate it's a real JPEG by checking for SOF marker (Start of Frame)
            let isValidJPEG = false;
            let is8Bit = false;
            // Search for SOF markers (0xC0 to 0xCF, except 0xC4, 0xC8, 0xCC)
            const headerSearchLimit = Math.min(currentPreview.length - 10, 65536); // Search deeper
            for (let i = 0; i < headerSearchLimit; i++) {
              if (currentPreview[i] === 0xff) {
                const marker = currentPreview[i+1];
                if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                  isValidJPEG = true;
                  // The byte at offset 4 (relative to 0xFF) is the data precision.
                  if (currentPreview[i+4] === 8) {
                    is8Bit = true;
                    break;
                  }
                }
              }
            }

            if (isValidJPEG && is8Bit) {
              // We want the largest JPEG found (usually the full-size preview)
              // But we also want to avoid tiny thumbnails
              if (currentPreview.length > 50000) { // At least 50KB for a decent preview
                if (!bestPreview || currentPreview.length > bestPreview.length) {
                  bestPreview = currentPreview;
                }
              }
            }
            
            searchIdx = endIdx + 2;
            searches++;
          }
          
          if (bestPreview) {
            previewBuffer = bestPreview;
            console.log(`[STRATEGY 3] Success: Extracted ${bestPreview.length} bytes preview from ${file.originalname}`);
          } else {
            console.log(`[STRATEGY 3] Failed: No valid 8-bit JPEG preview found in ${file.originalname}`);
          }
        }

        if (previewBuffer) {
          console.log(`Optimizing preview for ${file.originalname}, preview size: ${previewBuffer.length}`);
          
          // Use sharp to optimize and resize
          // We wrap this in a try-catch because even extracted JPEGs can sometimes be malformed
          try {
            const optimized = await sharp(previewBuffer)
              .rotate() // Auto-rotate based on EXIF
              .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 80, mozjpeg: true })
              .toBuffer();

            console.log(`Optimization complete for ${file.originalname}, optimized size: ${optimized.length}`);

            processedImages.push({
              name: file.originalname,
              base64: optimized.toString("base64"),
              mimeType: "image/jpeg"
            });
          } catch (sharpErr: any) {
            console.error(`Sharp optimization failed for ${file.originalname}:`, sharpErr);
            // Fallback: send the raw preview ONLY if it's not a precision error (which Gemini can't handle anyway)
            const isPrecisionError = sharpErr.message.includes('precision 14') || sharpErr.message.includes('precision 12');
            if (isPrecisionError) {
              processedImages.push({
                name: file.originalname,
                error: `Extracted preview is not a standard 8-bit JPEG (${sharpErr.message}).`
              });
            } else {
              processedImages.push({
                name: file.originalname,
                base64: previewBuffer.toString("base64"),
                mimeType: "image/jpeg"
              });
            }
          }
        } else {
          throw new Error("Could not extract preview from RAW file after trying all strategies. The file might be corrupted or an unsupported RAW format.");
        }
      } catch (err: any) {
        console.error(`Error processing ${file.originalname}:`, err);
        processedImages.push({
          name: file.originalname,
          error: err.message || "Failed to process RAW file"
        });
      } finally {
        // Clean up the uploaded file to save disk space
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error(`Failed to delete temporary file ${filePath}:`, e);
          }
        }
      }

      const success = processedImages.length > 0 && !processedImages[0].error;
      console.log(`Sending response for ${file.originalname}. Success: ${success}`);
      
      if (!success) {
        return res.status(422).json({ 
          error: processedImages[0]?.error || "Failed to process RAW file", 
          images: processedImages 
        });
      }
      
      try {
        res.json({ images: processedImages });
      } catch (jsonErr: any) {
        console.error(`JSON serialization error for ${file.originalname}:`, jsonErr);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to serialize image data", details: jsonErr.message });
        }
      }
    } catch (error: any) {
      console.error("Processing error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error during processing", details: error.message });
      }
    }
  });

  // API Route to convert image to TIFF
  app.post("/api/convert-to-tiff", async (req, res) => {
    try {
      const { imageBase64 } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "No image data provided" });
      }

      // Remove data URL prefix if present
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, 'base64');

      const tiffBuffer = await sharp(buffer)
        .tiff({
          compression: 'lzw',
          predictor: 'horizontal',
          xres: 300,
          yres: 300
        })
        .toBuffer();

      res.setHeader('Content-Type', 'image/tiff');
      res.setHeader('Content-Disposition', `attachment; filename=packshot-${Date.now()}.tiff`);
      res.send(tiffBuffer);
    } catch (error: any) {
      console.error("TIFF conversion error:", error);
      res.status(500).json({ error: "Failed to convert image to TIFF", details: error.message });
    }
  });

  // API Route for focus stacking with alignment
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
