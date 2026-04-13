/**
 * Credit & BYOK routes — credit purchase, BYOK key management, credit status.
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import { getEffectiveTier } from '../auth/middleware.js';
import { getAICreditsStatus } from './ai-credits.js';
import { storeBYOKKey, listUserBYOKProviders, deleteBYOKKey, AIProvider } from './byok.js';
import { supabaseAdmin } from '../db/supabase.js';

const router = Router();

const VALID_PROVIDERS: AIProvider[] = ['gemini', 'openai', 'grok', 'flux'];

/**
 * GET /api/credits/status — Get AI credit status for current user.
 */
router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const tier = getEffectiveTier(req);
    const status = await getAICreditsStatus(user.id, tier);
    const providers = await listUserBYOKProviders(user.id);

    res.json({
      ...status,
      byokProviders: providers.map(p => p.provider),
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch credit status' });
  }
});

/**
 * POST /api/credits/ai-key — Store a BYOK key for a provider.
 * Body: { provider: 'gemini'|'openai'|'grok'|'flux', key: 'xxx' }
 */
router.post('/ai-key', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { provider, key } = req.body;
    const user = req.user!;

    if (!provider || !VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(', ')}` });
    }
    if (!key || typeof key !== 'string' || key.length < 10) {
      return res.status(400).json({ error: 'Invalid API key (must be at least 10 characters)' });
    }

    // Only Pro and Studio can use BYOK
    const tier = getEffectiveTier(req);
    if (tier === 'free') {
      return res.status(403).json({
        error: 'BYOK requires a Pro or Studio subscription',
        code: 'BYOK_TIER_RESTRICTED',
        upgrade: 'pro',
      });
    }

    await storeBYOKKey(user.id, provider, key);
    res.json({ success: true, provider });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to store API key', details: err.message });
  }
});

/**
 * GET /api/credits/ai-keys — List BYOK providers (never returns actual keys).
 */
router.get('/ai-keys', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const providers = await listUserBYOKProviders(req.user!.id);
    res.json({ providers });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

/**
 * DELETE /api/credits/ai-key/:provider — Remove a BYOK key.
 */
router.delete('/ai-key/:provider', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const provider = req.params.provider as AIProvider;
    if (!VALID_PROVIDERS.includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider' });
    }

    await deleteBYOKKey(req.user!.id, provider);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

export { router as creditsRouter };
