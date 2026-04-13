/**
 * Supabase client initialization — used server-side with service role key
 * for full database access (bypasses RLS).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import pino from 'pino';

const log = pino({ level: 'info' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required in production');
  }
  // Dev mode: warn but allow startup for local development without DB
  log.warn('SUPABASE_URL or SUPABASE_SERVICE_KEY not set — database features will be limited');
}

/** Server-side Supabase client with service role (bypasses RLS). */
export const supabaseAdmin: SupabaseClient = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseServiceKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder',
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/** Get or create usage record for a user in a given month. */
export async function getOrCreateUsage(userId: string, month?: string) {
  const currentMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM

  const { data: existing } = await supabaseAdmin
    .from('usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', currentMonth)
    .single();

  if (existing) return existing;

  // Create new usage record for this month
  const { data: created, error } = await supabaseAdmin
    .from('usage')
    .insert({ user_id: userId, month: currentMonth })
    .select()
    .single();

  if (error) throw new Error(`Failed to create usage record: ${error.message}`);
  return created;
}

/** Increment deterministic image count for current month. */
export async function incrementDeterministicCount(userId: string) {
  const usage = await getOrCreateUsage(userId);
  const { error } = await supabaseAdmin
    .from('usage')
    .update({ deterministic_count: usage.deterministic_count + 1 })
    .eq('id', usage.id);
  if (error) throw new Error(`Failed to increment usage: ${error.message}`);
  return usage.deterministic_count + 1;
}

/** Increment AI usage count for current month. */
export async function incrementAICount(userId: string) {
  const usage = await getOrCreateUsage(userId);
  const { error } = await supabaseAdmin
    .from('usage')
    .update({ ai_count: usage.ai_count + 1 })
    .eq('id', usage.id);
  if (error) throw new Error(`Failed to increment AI usage: ${error.message}`);
  return usage.ai_count + 1;
}

/** Get user profile by ID. */
export async function getProfile(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

/** Update user tier. */
export async function updateUserTier(userId: string, tier: 'free' | 'pro' | 'studio') {
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ tier })
    .eq('id', userId);
  if (error) throw new Error(`Failed to update tier: ${error.message}`);
}

/** Get active subscription for a user. */
export async function getActiveSubscription(userId: string) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return data;
}
