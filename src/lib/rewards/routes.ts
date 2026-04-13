/**
 * Rewards API routes — referral code, stats, share claims, active credits.
 * Mounted at /api/rewards in server.ts.
 */

import { Router, Response } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import {
  getAvailableWatermarkExports,
  getAvailableBonusAICredits,
  grantReward,
  generateReferralCode,
  getActiveClaims,
  getReferralStats,
  getClaimedShares,
} from './rewards.js';

const router = Router();

const SHARE_REWARDS: Record<string, number> = {
  facebook: 2,
  linkedin: 4,
  twitter: 2,
};

/**
 * GET /api/rewards/status — complete rewards state for the current user.
 * Used by the rewards page and the download badge in PackshotGenerator.
 */
router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  try {
    const [watermarkExports, bonusAICredits, referralStats, claimedShares] = await Promise.all([
      getAvailableWatermarkExports(userId),
      getAvailableBonusAICredits(userId),
      getReferralStats(userId),
      getClaimedShares(userId),
    ]);

    res.json({
      watermarkExports,
      bonusAICredits,
      referralStats,
      claimedShares, // array of 'share_facebook', 'share_linkedin', 'share_twitter'
      shareRewards: SHARE_REWARDS,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch rewards status', details: err.message });
  }
});

/**
 * POST /api/rewards/claim-share — grant a one-time share reward for the given platform.
 * Body: { platform: 'facebook' | 'linkedin' | 'twitter' }
 * No verification — user just clicks the share button and we trust them.
 * Idempotent: 409 Conflict on duplicate claim (enforced by unique partial index).
 */
router.post('/claim-share', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  const { platform } = req.body;
  if (!platform || !['facebook', 'linkedin', 'twitter'].includes(platform)) {
    return res.status(400).json({ error: 'Invalid platform. Must be facebook, linkedin, or twitter.' });
  }

  const userId = req.user!.id;
  const source = `share_${platform}` as 'share_facebook' | 'share_linkedin' | 'share_twitter';
  const exportsToGrant = SHARE_REWARDS[platform];

  try {
    const { granted } = await grantReward({
      userId,
      source,
      watermarkExports: exportsToGrant,
      expiresInDays: null, // share rewards never expire
    });

    if (!granted) {
      return res.status(409).json({ error: 'Already claimed', code: 'ALREADY_CLAIMED' });
    }

    res.json({ success: true, granted: { watermarkExports: exportsToGrant } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to claim share reward', details: err.message });
  }
});

/**
 * GET /api/rewards/referral-link — returns the user's referral code and full URL.
 * Lazily creates a new code if the user doesn't have one yet.
 */
router.get('/referral-link', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const code = await generateReferralCode(req.user!.id);
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    res.json({ code, url: `${appUrl}/?ref=${code}` });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate referral link', details: err.message });
  }
});

/**
 * GET /api/rewards/active-claims — list of all non-expired, non-empty reward claims.
 * Shown in the rewards page "Active credits" table.
 */
router.get('/active-claims', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const claims = await getActiveClaims(req.user!.id);
    res.json({ claims });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch active claims', details: err.message });
  }
});

export { router as rewardsRouter };
