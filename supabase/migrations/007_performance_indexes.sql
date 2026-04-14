-- Migration 007: Add missing performance indexes
-- These indexes support common query patterns in rewards, referrals, email, and billing.

-- reward_claims: expiry cleanup queries and pagination
CREATE INDEX IF NOT EXISTS idx_reward_claims_expires_at
  ON reward_claims(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reward_claims_created_at
  ON reward_claims(created_at DESC);

-- referrals: paid referral lookup (used in reward issuance queries)
CREATE INDEX IF NOT EXISTS idx_referrals_became_paid_at
  ON referrals(became_paid_at)
  WHERE became_paid_at IS NOT NULL;

-- email_queue: retention cleanup and status queries
CREATE INDEX IF NOT EXISTS idx_email_queue_created_at
  ON email_queue(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_queue_status
  ON email_queue(status)
  WHERE status IN ('pending', 'failed');

-- subscriptions: billing reconciliation queries
CREATE INDEX IF NOT EXISTS idx_subscriptions_updated_at
  ON subscriptions(updated_at DESC);
