/**
 * AI Credit system — tracks, checks, and deducts AI credits per user.
 * Now multi-provider aware: resolves the best provider per request.
 *
 * Credit sources:
 * - Studio tier: 500 included/month
 * - Purchased credits: bought via Stripe, never expire
 * - BYOK: user's own key, no credits consumed
 *
 * Free tier: no AI access
 * Pro tier: must buy credits or use BYOK
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, getEffectiveTier } from '../auth/middleware.js';
import { supabaseAdmin, getOrCreateUsage, incrementAICount } from '../db/supabase.js';
import { TIER_LIMITS, Tier } from '../tier/limits.js';
import { getUserBYOKKey, listUserBYOKProviders } from './byok.js';
import { resolveProvider } from '../ai-providers/registry.js';
import type { AIProvider, ProviderName } from '../ai-providers/types.js';

/** AI credit limits per tier. */
const AI_CREDIT_LIMITS = {
  free: { included: 0, canPurchase: false },
  pro: { included: 0, canPurchase: true },
  studio: { included: 500, canPurchase: true },
} as const;

export { AI_CREDIT_LIMITS };

/**
 * Get available AI credits for a user.
 * Returns: { available, included, purchased, used, hasBYOK, byokProviders }
 */
export async function getAICreditsStatus(userId: string, tier: Tier) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = await getOrCreateUsage(userId, currentMonth);
  const limits = AI_CREDIT_LIMITS[tier];

  // Check all BYOK providers
  const providers = await listUserBYOKProviders(userId);
  const byokProviders = providers.map(p => p.provider);
  const hasBYOK = byokProviders.length > 0;

  const included = limits.included;
  const purchased = usage.ai_credits_purchased || 0;
  const used = usage.ai_count || 0;
  const available = Math.max(0, included + purchased - used);

  return {
    available,
    included,
    purchased,
    used,
    hasBYOK,
    byokProviders,
    canPurchase: limits.canPurchase,
    tier,
  };
}

/**
 * Middleware: check AI access, resolve provider, attach to request.
 * - Free tier: blocked (403)
 * - Pro/Studio with BYOK: resolves provider, no credit deduction
 * - Pro/Studio with credits: resolves to Gemini (server key), deducts 1 credit
 * - Pro/Studio without credits or BYOK: blocked (402)
 *
 * After this middleware, req._aiProvider and req._aiProviderName are set.
 */
export async function checkAICredits(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const tier = getEffectiveTier(req);

  // Free tier — normally blocked, but allow if user has bonus AI credits from rewards
  if (!TIER_LIMITS[tier].aiAccess) {
    if (req.user) {
      const { getAvailableBonusAICredits, consumeBonusAICredit } = await import('../rewards/rewards.js');
      const bonus = await getAvailableBonusAICredits(req.user.id);
      if (bonus > 0) {
        const consumed = await consumeBonusAICredit(req.user.id);
        if (consumed) {
          // Use server Gemini key (bonus credits always go through our account)
          const serverGeminiKey = process.env.GEMINI_API_KEY || '';
          const resolved = resolveProvider(new Map(), null, serverGeminiKey);
          (req as any)._aiProvider = resolved.provider;
          (req as any)._aiProviderName = resolved.providerName;
          (req as any)._usingBYOK = false;
          (req as any)._usingBonusCredit = true;
          await incrementAICount(req.user.id);
          return next();
        }
      }
    }
    return res.status(403).json({
      error: 'AI features require a Pro or Studio subscription',
      code: 'AI_ACCESS_DENIED',
      tier,
      upgrade: 'pro',
    });
  }

  // Must be authenticated for AI
  if (!req.user) {
    return res.status(401).json({
      error: 'Authentication required for AI features',
      code: 'AUTH_REQUIRED',
    });
  }

  try {
    // Collect all BYOK keys for this user
    const byokKeys = new Map<string, string>();
    const providerNames: ProviderName[] = ['gemini', 'openai', 'grok'];
    for (const name of providerNames) {
      const key = await getUserBYOKKey(req.user.id, name);
      if (key) byokKeys.set(name, key);
    }

    // Get user's preferred provider from request body or default
    const preferredProvider = (req.body?.provider as ProviderName) || null;

    if (byokKeys.size > 0) {
      // Has BYOK — resolve provider, no credits consumed
      const serverGeminiKey = process.env.GEMINI_API_KEY || '';
      const resolved = resolveProvider(byokKeys, preferredProvider, serverGeminiKey);

      (req as any)._aiProvider = resolved.provider;
      (req as any)._aiProviderName = resolved.providerName;
      (req as any)._usingBYOK = resolved.usingBYOK;

      // Track usage for analytics
      await incrementAICount(req.user.id);
      return next();
    }

    // No BYOK — check credits
    const status = await getAICreditsStatus(req.user.id, tier);

    if (status.available <= 0) {
      return res.status(402).json({
        error: 'No AI credits remaining',
        code: 'AI_CREDITS_EXHAUSTED',
        tier,
        used: status.used,
        included: status.included,
        purchased: status.purchased,
        canPurchase: status.canPurchase,
      });
    }

    // Has credits — use server Gemini key
    const serverGeminiKey = process.env.GEMINI_API_KEY || '';
    const resolved = resolveProvider(new Map(), null, serverGeminiKey);

    (req as any)._aiProvider = resolved.provider;
    (req as any)._aiProviderName = resolved.providerName;
    (req as any)._usingBYOK = false;

    // Deduct 1 credit
    await incrementAICount(req.user.id);
    next();
  } catch (err: any) {
    // Fail-open for availability
    next();
  }
}

/**
 * Get the resolved AI provider from a request (set by checkAICredits middleware).
 */
export function getAIProvider(req: any): AIProvider | null {
  return req._aiProvider || null;
}

/**
 * Get the resolved provider name from a request.
 */
export function getAIProviderName(req: any): ProviderName | null {
  return req._aiProviderName || null;
}

/**
 * Add purchased credits to a user's account.
 * Called from Stripe webhook on successful credit pack payment.
 */
export async function addPurchasedCredits(userId: string, credits: number) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const usage = await getOrCreateUsage(userId, currentMonth);

  const { error } = await supabaseAdmin
    .from('usage')
    .update({
      ai_credits_purchased: (usage.ai_credits_purchased || 0) + credits,
    })
    .eq('id', usage.id);

  if (error) throw new Error(`Failed to add credits: ${error.message}`);
  return (usage.ai_credits_purchased || 0) + credits;
}
