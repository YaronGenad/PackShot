/**
 * API key authentication middleware — for Studio REST API (v1 endpoints).
 * Checks Authorization: Bearer pk_live_xxx header, resolves to user.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';
import { hashApiKey, lookupApiKey } from './api-keys.js';

/**
 * Middleware: authenticate via API key (Bearer token).
 * Only works with pk_live_ prefixed keys. Falls through if no API key present.
 */
export function apiKeyAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer pk_live_')) {
    return res.status(401).json({
      error: 'API key required. Use Authorization: Bearer pk_live_xxx',
      code: 'API_KEY_REQUIRED',
    });
  }

  const key = authHeader.slice(7); // Remove "Bearer "
  const keyHash = hashApiKey(key);

  lookupApiKey(keyHash).then(profile => {
    if (!profile) {
      return res.status(401).json({
        error: 'Invalid API key',
        code: 'INVALID_API_KEY',
      });
    }

    if (profile.tier !== 'studio') {
      return res.status(403).json({
        error: 'API access requires Studio tier',
        code: 'STUDIO_REQUIRED',
      });
    }

    req.user = {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      storedTier: profile.tier,
      tier: profile.tier,
      stripe_customer_id: profile.stripe_customer_id,
      paypal_payer_id: profile.paypal_payer_id,
    };

    next();
  }).catch(() => {
    res.status(401).json({ error: 'Authentication failed', code: 'AUTH_ERROR' });
  });
}
