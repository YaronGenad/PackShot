/**
 * Watermark system — adds a diagonal tiled "Made with PackShot" pattern
 * across the entire image for Free tier exports. At 70% opacity so the
 * result is clearly visible but unusable as a final deliverable.
 *
 * Generated dynamically at apply time since tile count depends on image size.
 */

import sharp from 'sharp';

/** Cached single-tile watermark PNG (rotated diagonally, transparent bg). */
let tileBuffer: Buffer | null = null;
let tileWidth = 0;
let tileHeight = 0;

/** Generate one diagonal watermark tile — called once at server startup. */
export async function initWatermark(): Promise<void> {
  // Single tile: text rotated -30° with semi-transparent stroke+fill
  // Wider tile spacing = fewer repetitions, so we pick a mid-size box
  const w = 500;
  const h = 220;
  const tileSvg = `
    <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="softShadow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.5" />
        </filter>
      </defs>
      <g transform="translate(${w / 2} ${h / 2}) rotate(-30)">
        <text
          x="0" y="0"
          text-anchor="middle"
          dominant-baseline="middle"
          font-family="Arial, Helvetica, sans-serif"
          font-size="44"
          font-weight="bold"
          fill="rgba(255,255,255,0.2)"
          stroke="rgba(0,0,0,0.1)"
          stroke-width="1"
          filter="url(#softShadow)"
          letter-spacing="3">
          Made with PackShot
        </text>
      </g>
    </svg>
  `.trim();

  tileBuffer = await sharp(Buffer.from(tileSvg)).png().toBuffer();
  tileWidth = w;
  tileHeight = h;
}

/**
 * Apply the diagonal tiled watermark to an image buffer.
 * Generates a full-size overlay matching the image dimensions,
 * then composites it on top. At 70% the watermark is prominent
 * but doesn't fully obscure the product.
 */
export async function applyWatermark(imageBuffer: Buffer): Promise<Buffer> {
  if (!tileBuffer) await initWatermark();

  // Read image dimensions so we can build a full-size overlay
  const img = sharp(imageBuffer);
  const meta = await img.metadata();
  const imgW = meta.width || 2048;
  const imgH = meta.height || 2048;

  // How many tiles needed to cover the image (with extra margin for rotation)
  const cols = Math.ceil(imgW / tileWidth) + 1;
  const rows = Math.ceil(imgH / tileHeight) + 1;

  // Build composite operations: one tile per grid cell, offset diagonally
  // by half a tile every other row so the text pattern interlocks
  const composites = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offsetX = row % 2 === 0 ? 0 : tileWidth / 2;
      composites.push({
        input: tileBuffer!,
        left: Math.round(col * tileWidth - tileWidth / 2 + offsetX),
        top: Math.round(row * tileHeight - tileHeight / 2),
        blend: 'over' as const,
      });
    }
  }

  // Create a transparent canvas matching the image size and composite all tiles onto it
  const overlay = await sharp({
    create: {
      width: imgW,
      height: imgH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  // Apply the final overlay on the source image
  return sharp(imageBuffer)
    .composite([{ input: overlay, gravity: 'northwest' }])
    .toBuffer();
}

/** Check if watermark system is initialized. */
export function isWatermarkReady(): boolean {
  return tileBuffer !== null;
}
