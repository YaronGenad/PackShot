/**
 * Admin access middleware — gates /api/admin/* routes.
 * Reads ADMIN_USER_IDS (comma-separated UUIDs) from env and allows only those
 * through. authMiddleware must run first so req.user is populated.
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../auth/middleware.js';

function getAdminIds(): string[] {
  return (process.env.ADMIN_USER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function adminMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const admins = getAdminIds();
  if (admins.length === 0 || !admins.includes(req.user.id)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

export function isAdmin(userId: string | undefined): boolean {
  if (!userId) return false;
  return getAdminIds().includes(userId);
}
