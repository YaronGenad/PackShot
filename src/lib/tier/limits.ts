/**
 * Tier limits and enforcement — defines what each tier can do
 * and provides middleware to check quotas.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest, getEffectiveTier } from '../auth/middleware.js';
import { getOrCreateUsage, incrementDeterministicCount, supabaseAdmin, getProfile } from '../db/supabase.js';
import { sendUsageWarningEmail } from '../email/notifications.js';

/** Tier configuration — single source of truth. */
export const TIER_LIMITS = {
  free: {
    monthlyImages: 10,
    maxResolution: 2048,
    maxUploadFiles: 10,
    allowedExportFormats: ['jpeg', 'png'] as string[],
    aiAccess: false,
    watermark: true,
    uploadLimitMb: 100,
  },
  pro: {
    monthlyImages: 500,
    maxResolution: 8192,
    maxUploadFiles: 20,
    allowedExportFormats: ['jpeg', 'png', 'tiff', 'webp', 'avif', 'psd'] as string[],
    aiAccess: true,
    watermark: false,
    uploadLimitMb: 100,
  },
  studio: {
    monthlyImages: 5000,
    maxResolution: 8192,
    maxUploadFiles: 50,
    allowedExportFormats: ['jpeg', 'png', 'tiff', 'webp', 'avif', 'psd'] as string[],
    aiAccess: true,
    watermark: false,
    uploadLimitMb: 100,
  },
} as const;

export type Tier = keyof typeof TIER_LIMITS;

/** Get limits for current user's tier. */
export function getTierLimits(tier: Tier) {
  return TIER_LIMITS[tier];
}

/**
 * Middleware: check quota before processing an image.
 * Increments usage count if within limits, returns 402 if exceeded.
 */
export async function checkQuota(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const tier = getEffectiveTier(req);
  const limits = TIER_LIMITS[tier];

  // Anonymous users (no account) get free tier limits
  if (!req.user) {
    // For anonymous users, we can't track — allow but with free limits
    return next();
  }

  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = await getOrCreateUsage(req.user.id, currentMonth);

    // Trigger monthly rollover for Pro users on first request of new month
    if (tier === 'pro' && usage.deterministic_count === 0 && !usage._rollover_done) {
      try { await processMonthlyRollover(req.user.id); } catch (_) {}
    }

    // Calculate available images (including banked credits for Pro)
    const available = calculateAvailable(tier, usage);

    // Studio soft/hard limit: warn at 4K, block at 5K
    if (tier === 'studio' && usage.deterministic_count >= 5000) {
      return res.status(402).json({
        error: 'Studio monthly limit reached (5,000 images). Contact us for Enterprise.',
        code: 'STUDIO_HARD_LIMIT',
        tier,
        limit: 5000,
        used: usage.deterministic_count,
      });
    }

    if (usage.deterministic_count >= available) {
      return res.status(402).json({
        error: 'Monthly limit reached',
        code: 'QUOTA_EXCEEDED',
        tier,
        limit: available,
        used: usage.deterministic_count,
        upgrade: tier === 'free' ? 'pro' : tier === 'pro' ? 'studio' : null,
      });
    }

    // Increment count
    const newCount = await incrementDeterministicCount(req.user.id);

    // Send usage warning (once, when crossing threshold)
    // Studio: warn at 4000, others: warn at 90%
    const warningThreshold = tier === 'studio' ? 4000 : Math.floor(available * 0.9);
    if (newCount === warningThreshold && req.user.email) {
      sendUsageWarningEmail(req.user.email, newCount, available, tier).catch(() => {});
    }

    next();
  } catch (err: any) {
    // On DB error, allow request to proceed (fail-open for availability)
    next();
  }
}

/**
 * Calculate total available images including banked credits.
 */
function calculateAvailable(tier: Tier, usage: any): number {
  const base = TIER_LIMITS[tier].monthlyImages;
  if (tier === 'pro') {
    return base + (usage.banked_credits || 0);
  }
  return base;
}

/**
 * Middleware: check export format is allowed for the user's tier.
 */
export function checkExportFormat(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const tier = getEffectiveTier(req);
  const limits = TIER_LIMITS[tier];
  const format = req.body?.format || 'tiff';

  if (!limits.allowedExportFormats.includes(format)) {
    return res.status(403).json({
      error: `${format.toUpperCase()} export requires Pro or Studio tier`,
      code: 'FORMAT_RESTRICTED',
      tier,
      allowed: limits.allowedExportFormats,
      upgrade: 'pro',
    });
  }

  next();
}

/**
 * Get max resolution for user's tier.
 */
export function getMaxResolution(req: AuthenticatedRequest): number {
  const tier = getEffectiveTier(req);
  return TIER_LIMITS[tier].maxResolution;
}

/**
 * Get max upload file count for user's tier.
 */
export function getMaxUploadFiles(req: AuthenticatedRequest): number {
  const tier = getEffectiveTier(req);
  return TIER_LIMITS[tier].maxUploadFiles;
}

/**
 * Credit rollover logic — call on first request of a new month for Pro users.
 * Rolls unused credits from last month, capped at 2000 banked.
 */
export async function processMonthlyRollover(userId: string) {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Get last month
  const now = new Date();
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = lastMonthDate.toISOString().slice(0, 7);

  // Get last month's usage
  const { data: lastUsage } = await supabaseAdmin
    .from('usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', lastMonth)
    .single();

  if (!lastUsage) return; // No last month data, nothing to roll over

  // Calculate unused from last month
  const unused = Math.max(0, TIER_LIMITS.pro.monthlyImages - lastUsage.deterministic_count);

  if (unused <= 0) return;

  // Get or create current month usage
  const currentUsage = await getOrCreateUsage(userId, currentMonth);

  // Add unused to banked, cap at 2000
  const newBanked = Math.min(2000, (currentUsage.banked_credits || 0) + unused);

  if (newBanked !== currentUsage.banked_credits) {
    await supabaseAdmin
      .from('usage')
      .update({ banked_credits: newBanked })
      .eq('id', currentUsage.id);
  }
}
