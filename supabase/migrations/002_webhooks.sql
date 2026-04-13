-- Sprint 5: Add webhooks table for Studio API

CREATE TABLE IF NOT EXISTS public.webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{"job.completed","job.failed","credits.low"}',
  signing_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id) -- one webhook per user for simplicity
);

-- RLS
ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own webhooks" ON public.webhooks
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own webhooks" ON public.webhooks
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Service role full access webhooks" ON public.webhooks
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_webhooks_user_id ON public.webhooks(user_id);

CREATE TRIGGER update_webhooks_updated_at
  BEFORE UPDATE ON public.webhooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
