-- Migration 009: Pending iCount receipts queue + email retry counter
-- When iCount is down during a webhook, we persist the receipt intent
-- so a background worker can retry. Also adds retry_count to email_queue
-- so the email worker can bound retries.

-- iCount receipts to retry if the initial attempt failed
CREATE TABLE IF NOT EXISTS public.pending_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pending_receipts_status
  ON public.pending_receipts(status)
  WHERE status IN ('pending', 'failed');

ALTER TABLE public.pending_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access pending_receipts" ON public.pending_receipts
  FOR ALL USING (auth.role() = 'service_role');

-- Email queue: add retry_count so we can bound retries and know when to give up
ALTER TABLE public.email_queue
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
