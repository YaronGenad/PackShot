-- 005_paypal.sql — Add PayPal columns to subscriptions and profiles tables

-- Allow subscriptions to track PayPal subscription IDs alongside (or instead of) Stripe
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS paypal_subscription_id TEXT UNIQUE;

-- Make stripe_subscription_id nullable (was required before; now PayPal subs won't have one)
ALTER TABLE public.subscriptions
  ALTER COLUMN stripe_subscription_id DROP NOT NULL;

-- Store PayPal payer ID on profiles (equivalent of stripe_customer_id)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS paypal_payer_id TEXT;
