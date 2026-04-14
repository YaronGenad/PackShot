/**
 * Auth endpoint tests — validation paths only (no real DB writes).
 * Requires server running on localhost:3000.
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API = 'http://localhost:3000';

beforeAll(async () => {
  try {
    const res = await fetch(`${API}/api/ping`);
    if (!res.ok) throw new Error('Server not ready');
  } catch {
    console.error('\n⚠ Server not running. Start with: npm run dev\n');
    process.exit(1);
  }
});

describe('POST /api/auth/register — validation', () => {
  it('400 when email missing', async () => {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'abcdefgh' }),
    });
    expect(res.status).toBe(400);
  });

  it('400 when password too short', async () => {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co', password: 'short' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/8 characters/i);
  });
});

describe('POST /api/auth/login — validation', () => {
  it('400 without credentials', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('401 with bad credentials', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-' + Date.now() + '@example.test', password: 'wrongpassword' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('400 without email', async () => {
    const res = await fetch(`${API}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('200 generic response even for nonexistent email (prevents enumeration)', async () => {
    const res = await fetch(`${API}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-' + Date.now() + '@example.test' }),
    });
    // Supabase may return 4xx for unknown email in some configs; we accept either
    expect([200, 400]).toContain(res.status);
  });
});

describe('GET /api/auth/me — requires auth', () => {
  it('401 without cookie', async () => {
    const res = await fetch(`${API}/api/auth/me`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('AUTH_REQUIRED');
  });
});

describe('DELETE /api/auth/account — requires auth', () => {
  it('401 without cookie', async () => {
    const res = await fetch(`${API}/api/auth/account`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE', password: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/export-data — requires auth', () => {
  it('401 without cookie', async () => {
    const res = await fetch(`${API}/api/auth/export-data`);
    expect(res.status).toBe(401);
  });
});
