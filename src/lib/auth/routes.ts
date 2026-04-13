/**
 * Auth routes — registration, login, logout, profile.
 * Uses Supabase Auth (handles password hashing, JWT issuance, etc.)
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin, getProfile, getOrCreateUsage, getActiveSubscription } from '../db/supabase.js';
import { authMiddleware, AuthenticatedRequest } from './middleware.js';
import { sendWelcomeEmail } from '../email/notifications.js';

const router = Router();

/** Supabase anon key for client-side auth operations. */
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

/** Cookie options for auth tokens. */
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

/** Verify Cloudflare Turnstile CAPTCHA token server-side. */
async function verifyCaptcha(token: string, ip?: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Skip in dev if not configured

  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  });
  const data = await res.json() as { success: boolean };
  return data.success;
}

/**
 * POST /api/auth/register — Create account, require CAPTCHA, send email confirmation.
 * User cannot log in until they click the confirmation link in their email.
 */
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, name, captchaToken, referralCode } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Verify CAPTCHA (skip if TURNSTILE_SECRET_KEY not set — dev mode)
    if (process.env.TURNSTILE_SECRET_KEY) {
      if (!captchaToken) {
        return res.status(400).json({ error: 'CAPTCHA verification required' });
      }
      const captchaValid = await verifyCaptcha(captchaToken, req.ip);
      if (!captchaValid) {
        return res.status(403).json({ error: 'CAPTCHA verification failed. Please try again.' });
      }
    }

    // Validate referral code format (prevents injection)
    const validRef = referralCode && /^pk_[a-zA-Z0-9]{4,20}$/.test(referralCode) ? referralCode : null;

    // Create user — email_confirm: false means Supabase sends confirmation email
    // Referral code is stored in user_metadata so the handle_new_user trigger can capture it
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: {
        name: name || email.split('@')[0],
        ...(validRef ? { referral_code: validRef } : {}),
      },
    });

    if (error) {
      if (error.message.includes('already registered')) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      return res.status(400).json({ error: error.message });
    }

    // If there was a referral, record the signup IP for abuse prevention.
    // The trigger already inserted the referral row; we just augment it.
    if (validRef && data.user) {
      supabaseAdmin
        .from('referrals')
        .update({ signup_ip: req.ip || null })
        .eq('referred_user_id', data.user.id)
        .then(() => {}, () => {});
    }

    // Don't auto-login — user must confirm email first
    // Send welcome email (non-blocking)
    sendWelcomeEmail(email, name || email.split('@')[0]).catch(() => {});

    res.status(201).json({
      message: 'Account created! Check your email to confirm your account.',
      requiresConfirmation: true,
      email: data.user.email,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Registration failed', details: err.message });
  }
});

/**
 * POST /api/auth/resend-confirmation — Resend email confirmation link.
 */
router.post('/resend-confirmation', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabaseClient.auth.resend({ type: 'signup', email });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Confirmation email resent. Check your inbox.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to resend confirmation email' });
  }
});

/**
 * POST /api/auth/login — Sign in with email + password.
 */
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!data.session) {
      return res.status(401).json({ error: 'Login failed' });
    }

    // Set auth cookies
    res.cookie('sb-access-token', data.session.access_token, COOKIE_OPTIONS);
    res.cookie('sb-refresh-token', data.session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const profile = await getProfile(data.user.id);

    res.json({
      user: {
        id: data.user.id,
        email: data.user.email,
        name: profile?.name,
        tier: profile?.tier || 'free',
      },
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Login failed', details: err.message });
  }
});

/**
 * POST /api/auth/logout — Clear auth cookies.
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('sb-access-token', { path: '/' });
  res.clearCookie('sb-refresh-token', { path: '/' });
  res.json({ success: true });
});

/**
 * POST /api/auth/refresh — Refresh access token using refresh token.
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.['sb-refresh-token'] || req.body.refresh_token;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data, error } = await supabaseClient.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      res.clearCookie('sb-access-token', { path: '/' });
      res.clearCookie('sb-refresh-token', { path: '/' });
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    res.cookie('sb-access-token', data.session.access_token, COOKIE_OPTIONS);
    res.cookie('sb-refresh-token', data.session.refresh_token, {
      ...COOKIE_OPTIONS,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

/**
 * GET /api/auth/me — Get current user profile + tier + usage.
 */
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const currentMonth = new Date().toISOString().slice(0, 7);
    const usage = await getOrCreateUsage(user.id, currentMonth);
    const subscription = await getActiveSubscription(user.id);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        tier: user.tier,
      },
      usage: {
        month: currentMonth,
        deterministic_count: usage.deterministic_count,
        ai_count: usage.ai_count,
        ai_credits_purchased: usage.ai_credits_purchased,
        banked_credits: usage.banked_credits,
      },
      subscription: subscription ? {
        status: subscription.status,
        tier: subscription.tier,
        current_period_end: subscription.current_period_end,
        cancel_at_period_end: subscription.cancel_at_period_end,
      } : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

/**
 * POST /api/auth/forgot-password — Send password reset email.
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    const redirectTo = `${process.env.APP_URL || 'http://localhost:3000'}/?reset-password=true`;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    // Always return success (don't reveal whether email exists)
    res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to send reset email' });
  }
});

/**
 * POST /api/auth/reset-password — Set new password using access token from reset email.
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { access_token, new_password } = req.body;
    if (!access_token || !new_password) {
      return res.status(400).json({ error: 'Access token and new password are required' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);
    // Set the session from the reset token
    const { error: sessionError } = await supabaseClient.auth.setSession({
      access_token,
      refresh_token: '', // Not needed for password update
    });
    if (sessionError) {
      return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    }

    const { error } = await supabaseClient.auth.updateUser({ password: new_password });
    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

export { router as authRouter };
