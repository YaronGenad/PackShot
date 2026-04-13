-- Sprint: Rewards & Referrals System
-- Creates tables for tracking referrals, reward claims (watermark/AI credits),
-- and the Postgres functions needed for atomic credit consumption.
-- Also fixes the critical bug where /api/billing/remove-watermark purchases weren't persisted.

-- ═══════════════════════════════════════════════════════════════════
-- Table 1: referral_codes
-- Short URL-friendly slug per user (lazily created on first use)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referral_codes (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON public.referral_codes(code);

ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own referral code" ON public.referral_codes
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access referral_codes" ON public.referral_codes
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- Table 2: referrals
-- Event log — one row per referred signup
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_email TEXT NOT NULL,
  signup_ip INET,
  signup_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  email_confirmed_at TIMESTAMPTZ,
  became_paid_at TIMESTAMPTZ,
  free_reward_claimed_at TIMESTAMPTZ,
  paid_reward_claimed_at TIMESTAMPTZ,
  UNIQUE(referred_user_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_email_confirmed ON public.referrals(email_confirmed_at)
  WHERE email_confirmed_at IS NOT NULL;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view referrals they made" ON public.referrals
  FOR SELECT USING (auth.uid() = referrer_id);
CREATE POLICY "Service role full access referrals" ON public.referrals
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- Table 3: reward_claims
-- Append-only ledger — single source of truth for all earned credits
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.reward_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN (
    'share_facebook','share_linkedin','share_twitter',
    'referral_free','referral_paid','milestone_10_paid',
    'purchase_watermark'
  )),
  watermark_exports_granted INTEGER NOT NULL DEFAULT 0,
  ai_credits_granted INTEGER NOT NULL DEFAULT 0,
  pro_months_granted INTEGER NOT NULL DEFAULT 0,
  watermark_exports_remaining INTEGER NOT NULL DEFAULT 0,
  ai_credits_remaining INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,  -- NULL = never expires
  referral_id UUID REFERENCES public.referrals(id)
);

-- Index for fast "available credits" queries
CREATE INDEX IF NOT EXISTS idx_reward_claims_user_active ON public.reward_claims(user_id)
  WHERE watermark_exports_remaining > 0 OR ai_credits_remaining > 0;

-- Partial unique index: share rewards and milestone are one-per-user;
-- referral_free, referral_paid, and purchase_watermark can repeat
CREATE UNIQUE INDEX IF NOT EXISTS uniq_once_per_user_reward
  ON public.reward_claims(user_id, source)
  WHERE source IN ('share_facebook','share_linkedin','share_twitter','milestone_10_paid');

ALTER TABLE public.reward_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own reward claims" ON public.reward_claims
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access reward_claims" ON public.reward_claims
  FOR ALL USING (auth.role() = 'service_role');

-- ═══════════════════════════════════════════════════════════════════
-- New columns on profiles
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pro_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS granted_pro_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_free_claims_this_month INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referral_free_claims_month TEXT;

-- ═══════════════════════════════════════════════════════════════════
-- Function: consume_watermark_export
-- Atomically decrements one watermark credit from the soonest-expiring claim.
-- Returns TRUE if a credit was consumed, FALSE if none available.
-- Uses FOR UPDATE SKIP LOCKED for race-safety under concurrent exports.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_watermark_export(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_claim_id UUID;
BEGIN
  SELECT id INTO v_claim_id FROM public.reward_claims
  WHERE user_id = p_user_id
    AND watermark_exports_remaining > 0
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY expires_at NULLS LAST, claimed_at ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_claim_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.reward_claims
    SET watermark_exports_remaining = watermark_exports_remaining - 1
  WHERE id = v_claim_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════
-- Function: consume_bonus_ai_credit
-- Same pattern for bonus AI credits granted to free-tier users via referrals.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_bonus_ai_credit(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE v_claim_id UUID;
BEGIN
  SELECT id INTO v_claim_id FROM public.reward_claims
  WHERE user_id = p_user_id
    AND ai_credits_remaining > 0
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY expires_at NULLS LAST, claimed_at ASC
  LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF v_claim_id IS NULL THEN RETURN FALSE; END IF;
  UPDATE public.reward_claims
    SET ai_credits_remaining = ai_credits_remaining - 1
  WHERE id = v_claim_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════
-- Modified trigger: handle_new_user
-- Captures referrals when the new user has a referral_code in metadata.
-- Self-referral is blocked. Runs in addition to the existing profile insert.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_ref_code TEXT;
  v_referrer_id UUID;
BEGIN
  -- Original profile insert
  INSERT INTO public.profiles (id, email, name, tier)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)), 'free');

  -- Referral capture (new behavior)
  v_ref_code := NEW.raw_user_meta_data->>'referral_code';
  IF v_ref_code IS NOT NULL AND v_ref_code != '' THEN
    SELECT user_id INTO v_referrer_id FROM public.referral_codes WHERE code = v_ref_code;
    IF v_referrer_id IS NOT NULL AND v_referrer_id != NEW.id THEN
      INSERT INTO public.referrals (referrer_id, referred_user_id, referred_email)
      VALUES (v_referrer_id, NEW.id, NEW.email)
      ON CONFLICT (referred_user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Trigger itself is unchanged (already exists from 001_initial_schema.sql)

-- ═══════════════════════════════════════════════════════════════════
-- Trigger: settle_referral_on_confirm
-- When Supabase marks auth.users.email_confirmed_at, update referrals row.
-- Actual reward issuance happens in a separate trigger on public.referrals.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.settle_referral_on_confirm()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL THEN
    UPDATE public.referrals
    SET email_confirmed_at = NEW.email_confirmed_at
    WHERE referred_user_id = NEW.id AND email_confirmed_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.settle_referral_on_confirm();

-- ═══════════════════════════════════════════════════════════════════
-- Trigger: grant_referral_free_reward
-- When referrals.email_confirmed_at is set, grant 1 watermark_exports credit
-- to the referrer. Subject to monthly cap of 10 per referrer.
-- Resets the monthly counter when a new month starts.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.grant_referral_free_reward()
RETURNS TRIGGER AS $$
DECLARE
  v_current_month TEXT;
  v_referrer_month TEXT;
  v_claims_count INTEGER;
BEGIN
  -- Only act when email_confirmed_at transitions to non-NULL
  IF OLD.email_confirmed_at IS NOT NULL OR NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
  END IF;

  v_current_month := to_char(now(), 'YYYY-MM');

  -- Fetch and reset the referrer's monthly counter if needed
  SELECT referral_free_claims_month INTO v_referrer_month
  FROM public.profiles WHERE id = NEW.referrer_id FOR UPDATE;

  IF v_referrer_month IS DISTINCT FROM v_current_month THEN
    UPDATE public.profiles
    SET referral_free_claims_this_month = 0,
        referral_free_claims_month = v_current_month
    WHERE id = NEW.referrer_id;
  END IF;

  SELECT referral_free_claims_this_month INTO v_claims_count
  FROM public.profiles WHERE id = NEW.referrer_id;

  -- Monthly cap of 10
  IF v_claims_count >= 10 THEN
    RETURN NEW;  -- silently skip — future claims still allowed
  END IF;

  -- Issue the reward
  INSERT INTO public.reward_claims (
    user_id, source, watermark_exports_granted, watermark_exports_remaining, referral_id
  ) VALUES (
    NEW.referrer_id, 'referral_free', 1, 1, NEW.id
  );

  -- Mark as claimed and increment counter
  UPDATE public.referrals SET free_reward_claimed_at = now() WHERE id = NEW.id;
  UPDATE public.profiles
  SET referral_free_claims_this_month = referral_free_claims_this_month + 1
  WHERE id = NEW.referrer_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_referral_confirmed ON public.referrals;
CREATE TRIGGER on_referral_confirmed
  AFTER UPDATE ON public.referrals
  FOR EACH ROW EXECUTE FUNCTION public.grant_referral_free_reward();

-- ═══════════════════════════════════════════════════════════════════
-- Function: shift_reward_expirations
-- Called from handleSubscriptionDeleted when a user downgrades from Pro.
-- Shifts all unexpired expires_at forward by the Pro duration so the
-- 3-month countdown effectively pauses during Pro.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.shift_reward_expirations(p_user_id UUID, p_interval_ms BIGINT)
RETURNS VOID AS $$
BEGIN
  UPDATE public.reward_claims
  SET expires_at = expires_at + (p_interval_ms * interval '1 millisecond')
  WHERE user_id = p_user_id
    AND expires_at IS NOT NULL
    AND expires_at > now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
