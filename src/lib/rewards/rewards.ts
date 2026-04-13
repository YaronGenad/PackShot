/**
 * Rewards helpers — single source of truth for watermark/AI credit ledger.
 * All callers (export endpoint, webhooks, share claims) go through grantReward
 * and consume* functions. Consumption uses Postgres RPCs for race-safety.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../db/supabase.js';

export type RewardSource =
  | 'share_facebook'
  | 'share_linkedin'
  | 'share_twitter'
  | 'referral_free'
  | 'referral_paid'
  | 'milestone_10_paid'
  | 'purchase_watermark';

export interface GrantRewardParams {
  userId: string;
  source: RewardSource;
  watermarkExports?: number;
  aiCredits?: number;
  proMonths?: number;
  expiresInDays?: number | null; // null = never expires
  referralId?: string;
}

/** Sum all non-expired watermark export credits across the user's active claims. */
export async function getAvailableWatermarkExports(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('reward_claims')
    .select('watermark_exports_remaining')
    .eq('user_id', userId)
    .gt('watermark_exports_remaining', 0)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) return 0;
  return (data || []).reduce((sum, r: any) => sum + (r.watermark_exports_remaining || 0), 0);
}

/** Sum all non-expired bonus AI credits (used for free-tier users who earned via referrals). */
export async function getAvailableBonusAICredits(userId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('reward_claims')
    .select('ai_credits_remaining')
    .eq('user_id', userId)
    .gt('ai_credits_remaining', 0)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) return 0;
  return (data || []).reduce((sum, r: any) => sum + (r.ai_credits_remaining || 0), 0);
}

/** Atomically decrement one watermark credit. Returns true if consumed. */
export async function consumeWatermarkExport(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('consume_watermark_export', { p_user_id: userId });
  if (error) return false;
  return data === true;
}

/** Atomically decrement one bonus AI credit. Returns true if consumed. */
export async function consumeBonusAICredit(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('consume_bonus_ai_credit', { p_user_id: userId });
  if (error) return false;
  return data === true;
}

/**
 * Insert a new reward_claims row. For one-per-user sources (shares, milestone),
 * uses the unique partial index to silently skip duplicates.
 */
export async function grantReward(params: GrantRewardParams): Promise<{ granted: boolean; claimId?: string }> {
  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const wmGranted = params.watermarkExports || 0;
  const aiGranted = params.aiCredits || 0;

  const { data, error } = await supabaseAdmin
    .from('reward_claims')
    .insert({
      user_id: params.userId,
      source: params.source,
      watermark_exports_granted: wmGranted,
      ai_credits_granted: aiGranted,
      pro_months_granted: params.proMonths || 0,
      watermark_exports_remaining: wmGranted,
      ai_credits_remaining: aiGranted,
      expires_at: expiresAt,
      referral_id: params.referralId || null,
    })
    .select('id')
    .single();

  if (error) {
    // Unique constraint violation for one-per-user sources — silently skip
    if (error.code === '23505') return { granted: false };
    throw error;
  }
  return { granted: true, claimId: data?.id };
}

/** Generate a short URL-safe referral code for the user. Lazily creates if none exists. */
export async function generateReferralCode(userId: string): Promise<string> {
  // Check if the user already has one
  const { data: existing } = await supabaseAdmin
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle();
  if (existing?.code) return existing.code;

  // Create a new 10-char base32 slug (~50 bits of entropy)
  // Retry on collision (extremely unlikely but possible)
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = 'pk_' + crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 8);
    const { error } = await supabaseAdmin
      .from('referral_codes')
      .insert({ user_id: userId, code: slug });
    if (!error) return slug;
    if (error.code !== '23505') throw error; // non-uniqueness error
  }
  throw new Error('Failed to generate unique referral code after 5 attempts');
}

/** Look up the referrer_id for a given referral code. Returns null if not found. */
export async function getReferrerByCode(code: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('referral_codes')
    .select('user_id')
    .eq('code', code)
    .maybeSingle();
  return data?.user_id || null;
}

/** List active (non-expired, non-empty) reward claims for a user — used in the rewards page. */
export async function getActiveClaims(userId: string) {
  const { data } = await supabaseAdmin
    .from('reward_claims')
    .select('id, source, watermark_exports_granted, watermark_exports_remaining, ai_credits_granted, ai_credits_remaining, claimed_at, expires_at')
    .eq('user_id', userId)
    .or('watermark_exports_remaining.gt.0,ai_credits_remaining.gt.0')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('claimed_at', { ascending: false });
  return data || [];
}

/** Count referrals for a user — for rewards page stats and milestone checks. */
export async function getReferralStats(userId: string) {
  const { count: total } = await supabaseAdmin
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  const { count: paid } = await supabaseAdmin
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId)
    .not('became_paid_at', 'is', null);

  return { total: total || 0, paid: paid || 0 };
}

/** Which share platforms has this user already claimed? Used by UI. */
export async function getClaimedShares(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('reward_claims')
    .select('source')
    .eq('user_id', userId)
    .in('source', ['share_facebook', 'share_linkedin', 'share_twitter']);
  return (data || []).map((r: any) => r.source);
}
