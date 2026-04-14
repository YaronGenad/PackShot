-- Migration 008: Webhook idempotency log
-- PayPal retries webhooks. Without dedupe we double-credit AI credits,
-- double-send iCount receipts, and duplicate referral rewards.

CREATE TABLE IF NOT EXISTS public.processed_webhooks (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_processed_webhooks_processed_at
  ON public.processed_webhooks(processed_at DESC);

ALTER TABLE public.processed_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access processed_webhooks" ON public.processed_webhooks
  FOR ALL USING (auth.role() = 'service_role');
