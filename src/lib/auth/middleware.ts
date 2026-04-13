/**
 * Authentication middleware — verifies Supabase JWT from cookie or Authorization header.
 * Sets req.user with profile data (id, email, tier, etc.)
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin, getProfile, getOrCreateUsage } from '../db/supabase.js';

/** Extended request with user data. */
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
    tier: 'free' | 'pro' | 'studio'; // effective tier (already accounts for granted_pro_until)
    storedTier: 'free' | 'pro' | 'studio'; // the actual tier column in DB (for UI to show)
    stripe_customer_id: string | null;
    paypal_payer_id: string | null;
    granted_pro_until?: string | null;
    usage?: {
      deterministic_count: number;
      ai_count: number;
      ai_credits_purchased: number;
      banked_credits: number;
    };
  };
}

/**
 * Compute effective tier: if user has a non-expired granted_pro_until from a milestone
 * reward, treat them as 'pro' even if their stored tier is 'free'.
 */
function computeEffectiveTier(storedTier: 'free' | 'pro' | 'studio', grantedProUntil: string | null | undefined): 'free' | 'pro' | 'studio' {
  if (storedTier !== 'free') return storedTier; // pro/studio always wins
  if (grantedProUntil && new Date(grantedProUntil) > new Date()) return 'pro';
  return 'free';
}

/** Extract JWT token from cookie or Authorization header. */
function extractToken(req: Request): string | null {
  // Check cookie first
  const cookieToken = req.cookies?.['sb-access-token'];
  if (cookieToken) return cookieToken;

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  return null;
}

/**
 * Required auth — rejects unauthenticated requests with 401.
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  supabaseAdmin.auth.getUser(token).then(async ({ data, error }) => {
    if (error || !data.user) {
      return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
    }

    const profile = await getProfile(data.user.id);
    if (!profile) {
      return res.status(401).json({ error: 'User profile not found', code: 'PROFILE_NOT_FOUND' });
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      storedTier: profile.tier,
      tier: computeEffectiveTier(profile.tier, profile.granted_pro_until),
      stripe_customer_id: profile.stripe_customer_id,
      paypal_payer_id: profile.paypal_payer_id,
      granted_pro_until: profile.granted_pro_until,
    };

    next();
  }).catch(() => {
    res.status(401).json({ error: 'Authentication failed', code: 'AUTH_ERROR' });
  });
}

/**
 * Optional auth — attaches user if authenticated, continues as anonymous if not.
 * Anonymous users get free tier limits.
 */
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    // Anonymous — proceed without user (free tier)
    return next();
  }

  supabaseAdmin.auth.getUser(token).then(async ({ data, error }) => {
    if (!error && data.user) {
      const profile = await getProfile(data.user.id);
      if (profile) {
        req.user = {
          id: profile.id,
          email: profile.email,
          name: profile.name,
          storedTier: profile.tier,
          tier: computeEffectiveTier(profile.tier, profile.granted_pro_until),
          stripe_customer_id: profile.stripe_customer_id,
          paypal_payer_id: profile.paypal_payer_id,
          granted_pro_until: profile.granted_pro_until,
        };
      }
    }
    next();
  }).catch(() => {
    // Silent fail — proceed as anonymous
    next();
  });
}

/** Get the effective tier for a request (authenticated or anonymous free). */
export function getEffectiveTier(req: AuthenticatedRequest): 'free' | 'pro' | 'studio' {
  return req.user?.tier || 'free';
}
