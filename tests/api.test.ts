/**
 * Server API integration tests — tests actual endpoints.
 * Requires server running on localhost:3000.
 * Run: npm run dev (in another terminal), then npm test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const API = 'http://localhost:3000';

/** Create a test PNG image as base64. */
async function createTestPNG(width = 100, height = 100): Promise<string> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 128, b: 0 } },
  }).png().toBuffer();
  return buf.toString('base64');
}

/** Create a multipart body for file upload. */
function createMultipartBody(filePath: string, fieldName = 'images') {
  const fileData = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const boundary = '----TestBoundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fileData,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

// Check if server is running before tests
beforeAll(async () => {
  try {
    const res = await fetch(`${API}/api/ping`);
    if (!res.ok) throw new Error('Server not ready');
  } catch {
    console.error('\n⚠ Server not running. Start with: npm run dev\n');
    process.exit(1);
  }
});

describe('GET /api/ping', () => {
  it('returns ok status', async () => {
    const res = await fetch(`${API}/api/ping`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });
});

describe('POST /api/export', () => {
  let testBase64: string;

  beforeAll(async () => {
    testBase64 = await createTestPNG();
  });

  it.each(['tiff', 'jpeg', 'png', 'webp', 'avif', 'psd'])('exports %s format', async (format) => {
    const res = await fetch(`${API}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: testBase64, format }),
    });
    expect(res.status).toBe(200);
    const blob = await res.arrayBuffer();
    expect(blob.byteLength).toBeGreaterThan(0);
  });

  it('returns 400 without image data', async () => {
    const res = await fetch(`${API}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'jpeg' }),
    });
    expect(res.status).toBe(400);
  });

  it('defaults to TIFF when no format specified', async () => {
    const res = await fetch(`${API}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: testBase64 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('tiff');
  });
});

describe('POST /api/process-raw', () => {
  it('processes a valid CR2 file', async () => {
    const testDir = path.join(process.cwd(), 'exemplsForTests', 'third');
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.CR2'));
    if (files.length === 0) return; // Skip if no test data

    const { body, boundary } = createMultipartBody(path.join(testDir, files[0]));
    const res = await fetch(`${API}/api/process-raw`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.images).toBeDefined();
    expect(data.images.length).toBe(1);
    expect(data.images[0].base64.length).toBeGreaterThan(100);
    expect(data.images[0].mimeType).toBe('image/jpeg');
  });

  it('returns 400 without file', async () => {
    const res = await fetch(`${API}/api/process-raw`, {
      method: 'POST',
    });
    // Multer returns 400 or the handler returns 400
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /api/focus-stack', () => {
  it('returns error for less than 2 images', async () => {
    const res = await fetch(`${API}/api/focus-stack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: [{ base64: 'x', mimeType: 'image/jpeg' }] }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('INSUFFICIENT_IMAGES');
  });

  it('returns error for empty body', async () => {
    const res = await fetch(`${API}/api/focus-stack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('Gemini API key management', () => {
  it('GET /api/has-gemini-key returns hasKey boolean', async () => {
    const res = await fetch(`${API}/api/has-gemini-key`);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(typeof data.hasKey).toBe('boolean');
  });

  it('POST /api/set-gemini-key rejects invalid key', async () => {
    const res = await fetch(`${API}/api/set-gemini-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'short' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/set-gemini-key accepts valid key', async () => {
    const res = await fetch(`${API}/api/set-gemini-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'test-key-that-is-long-enough' }),
    });
    expect(res.status).toBe(200);

    // Verify it was set
    const check = await fetch(`${API}/api/has-gemini-key`);
    const data = await check.json();
    expect(data.hasKey).toBe(true);

    // Reset
    await fetch(`${API}/api/reset-gemini-key`, { method: 'POST' });
  });
});

describe('Security headers', () => {
  it('includes security headers from helmet', async () => {
    const res = await fetch(`${API}/api/ping`);
    // Helmet adds these by default
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBeTruthy();
  });

  it('prevents caching of API responses', async () => {
    const res = await fetch(`${API}/api/ping`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('404 handling', () => {
  it('returns 404 for unknown API routes', async () => {
    const res = await fetch(`${API}/api/nonexistent`);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain('not found');
  });
});
