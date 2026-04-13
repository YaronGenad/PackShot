/**
 * API Key management — generate, list, revoke Studio API keys.
 * Keys are random 32-byte hex strings, stored as SHA-256 hashes.
 * Format: pk_live_<64 hex chars>
 */

import crypto from 'crypto';
import { Router, Response } from 'express';
import { supabaseAdmin, getProfile } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';

const router = Router();

/** Generate a random API key with prefix. */
function generateApiKey(): { key: string; hash: string; prefix: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const key = `pk_live_${raw}`;
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const prefix = `pk_live_${raw.slice(0, 8)}...`;
  return { key, hash, prefix };
}

/** Hash an API key for lookup. */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * POST /api/api-keys — Generate a new API key (Studio only).
 * Body: { name?: string }
 */
router.post('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    if (user.tier !== 'studio') {
      return res.status(403).json({
        error: 'API keys are available for Studio tier only',
        code: 'STUDIO_REQUIRED',
        upgrade: 'studio',
      });
    }

    const name = req.body.name || 'Default';
    const { key, hash, prefix } = generateApiKey();

    const { error } = await supabaseAdmin
      .from('api_keys')
      .insert({
        user_id: user.id,
        key_hash: hash,
        key_prefix: prefix,
        name,
      });

    if (error) {
      return res.status(500).json({ error: 'Failed to create API key', details: error.message });
    }

    // Return the full key ONCE — it can never be retrieved again
    res.status(201).json({
      key,
      prefix,
      name,
      message: 'Save this key securely — it will not be shown again.',
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate API key' });
  }
});

/**
 * GET /api/api-keys — List API keys (masked, never shows full key).
 */
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    if (user.tier !== 'studio') {
      return res.status(403).json({ error: 'API keys are available for Studio tier only' });
    }

    const { data, error } = await supabaseAdmin
      .from('api_keys')
      .select('id, key_prefix, name, last_used, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to list API keys' });
    }

    res.json({ keys: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * DELETE /api/api-keys/:id — Revoke an API key.
 */
router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const keyId = req.params.id;

    const { error } = await supabaseAdmin
      .from('api_keys')
      .delete()
      .eq('id', keyId)
      .eq('user_id', user.id); // ensure user owns the key

    if (error) {
      return res.status(500).json({ error: 'Failed to revoke API key' });
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

/**
 * Look up a user by API key hash.
 * Returns the user profile or null if key not found.
 */
export async function lookupApiKey(keyHash: string) {
  const { data } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id')
    .eq('key_hash', keyHash)
    .single();

  if (!data) return null;

  // Update last_used timestamp
  await supabaseAdmin
    .from('api_keys')
    .update({ last_used: new Date().toISOString() })
    .eq('id', data.id);

  // Get the user profile
  const profile = await getProfile(data.user_id);
  return profile;
}

export { router as apiKeysRouter };
