/**
 * Admin API — minimal dashboard for support + metrics.
 * Gated by adminMiddleware; never exposed to regular users.
 */

import { Router, Response } from 'express';
import pino from 'pino';
import { supabaseAdmin, updateUserTier } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from '../auth/middleware.js';
import { adminMiddleware } from './middleware.js';
import { grantReward } from '../rewards/rewards.js';

const log = pino({ level: 'info' });
const router = Router();

router.use(authMiddleware, adminMiddleware);

/**
 * GET /api/admin/stats — high-level metrics for the dashboard.
 */
router.get('/stats', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const monthStart = `${currentMonth}-01T00:00:00Z`;

    const [totalUsers, tierBreakdown, activeSubs, newUsersThisMonth, usageThisMonth] = await Promise.all([
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('profiles').select('tier'),
      supabaseAdmin.from('subscriptions').select('tier, current_period_end').eq('status', 'active'),
      supabaseAdmin.from('profiles').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
      supabaseAdmin.from('usage').select('deterministic_count, ai_count').eq('month', currentMonth),
    ]);

    const tiers = { free: 0, pro: 0, studio: 0 } as Record<string, number>;
    for (const r of tierBreakdown.data || []) tiers[r.tier] = (tiers[r.tier] || 0) + 1;

    // MRR estimate: monthly plan prices × active subs, yearly prorated
    const monthlyPrices: Record<string, number> = {
      [process.env.PAYPAL_PLAN_PRO_MONTHLY || '']: 19,
      [process.env.PAYPAL_PLAN_PRO_YEARLY || '']: 200 / 12,
      [process.env.PAYPAL_PLAN_STUDIO_MONTHLY || '']: 49,
      [process.env.PAYPAL_PLAN_STUDIO_YEARLY || '']: 500 / 12,
    };
    // We don't store plan_id on the subscription row — approximate by tier:
    // assume monthly pricing for any active sub (conservative lower bound).
    const mrr = (activeSubs.data || []).reduce((sum, s: any) => {
      if (s.tier === 'pro') return sum + 19;
      if (s.tier === 'studio') return sum + 49;
      return sum;
    }, 0);

    const usage = (usageThisMonth.data || []).reduce(
      (acc, u: any) => ({
        det: acc.det + (u.deterministic_count || 0),
        ai: acc.ai + (u.ai_count || 0),
      }),
      { det: 0, ai: 0 },
    );

    res.json({
      users: { total: totalUsers.count || 0, new_this_month: newUsersThisMonth.count || 0 },
      tiers,
      subscriptions: { active: (activeSubs.data || []).length },
      mrr_usd: mrr,
      usage_this_month: {
        deterministic_stacks: usage.det,
        ai_operations: usage.ai,
      },
    });
  } catch (err: any) {
    log.error({ err: err.message }, 'admin stats error');
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/admin/users — paginated list with optional email search.
 */
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = (req.query.search as string || '').trim();
    const limit = Math.min(parseInt((req.query.limit as string) || '50', 10), 200);
    const offset = parseInt((req.query.offset as string) || '0', 10);

    let q = supabaseAdmin
      .from('profiles')
      .select('id, email, name, tier, created_at, pro_started_at, granted_pro_until', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) q = q.ilike('email', `%${search}%`);

    const { data, count, error } = await q;
    if (error) throw error;

    res.json({ users: data || [], total: count || 0, limit, offset });
  } catch (err: any) {
    log.error({ err: err.message }, 'admin users list error');
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/admin/users/:id — full user detail.
 */
router.get('/users/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;

    const [profile, subs, usage, rewards, referrals] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).single(),
      supabaseAdmin.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
      supabaseAdmin.from('usage').select('*').eq('user_id', userId).order('month', { ascending: false }).limit(12),
      supabaseAdmin.from('reward_claims').select('*').eq('user_id', userId).order('claimed_at', { ascending: false }),
      supabaseAdmin.from('referrals').select('*').eq('referrer_id', userId),
    ]);

    if (profile.error || !profile.data) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      profile: profile.data,
      subscriptions: subs.data || [],
      usage: usage.data || [],
      reward_claims: rewards.data || [],
      referrals: referrals.data || [],
    });
  } catch (err: any) {
    log.error({ err: err.message }, 'admin user detail error');
    res.status(500).json({ error: 'Failed to fetch user detail' });
  }
});

/**
 * POST /api/admin/users/:id/grant-credits — hand out AI credits (support ticket).
 * Body: { credits: number, reason?: string }
 */
router.post('/users/:id/grant-credits', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;
    const credits = parseInt(req.body?.credits, 10);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 10000) {
      return res.status(400).json({ error: 'credits must be a positive integer ≤ 10000' });
    }

    await grantReward({
      userId,
      source: 'purchase_watermark', // closest non-unique source; admin grants don't map to a real source
      aiCredits: credits,
      expiresInDays: null,
    });

    log.info({ adminId: req.user!.id, userId, credits, reason: req.body?.reason }, 'Admin granted AI credits');
    res.json({ success: true, credits });
  } catch (err: any) {
    log.error({ err: err.message }, 'admin grant-credits error');
    res.status(500).json({ error: 'Failed to grant credits' });
  }
});

/**
 * POST /api/admin/users/:id/override-tier — force-set user tier (support edge case).
 * Body: { tier: 'free' | 'pro' | 'studio' }
 */
router.post('/users/:id/override-tier', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.params.id;
    const { tier } = req.body;
    if (!['free', 'pro', 'studio'].includes(tier)) {
      return res.status(400).json({ error: 'tier must be free, pro, or studio' });
    }
    await updateUserTier(userId, tier);
    log.info({ adminId: req.user!.id, userId, tier }, 'Admin override user tier');
    res.json({ success: true, tier });
  } catch (err: any) {
    log.error({ err: err.message }, 'admin override-tier error');
    res.status(500).json({ error: 'Failed to override tier' });
  }
});

export { router as adminRouter };
