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

/** Get or create usage record for a user in a given month.
 *  When creating a new month, carries forward purchased credits from the most recent prior month
 *  (purchased credits never expire). */
export async function getOrCreateUsage(userId: string, month?: string) {
  const currentMonth = month || new Date().toISOString().slice(0, 7); // YYYY-MM

  const { data: existing } = await supabaseAdmin
    .from('usage')
    .select('*')
    .eq('user_id', userId)
    .eq('month', currentMonth)
    .single();

  if (existing) return existing;

  // Carry forward purchased credits from the most recent prior month
  let carryForwardCredits = 0;
  const { data: previous } = await supabaseAdmin
    .from('usage')
    .select('ai_credits_purchased')
    .eq('user_id', userId)
    .lt('month', currentMonth)
    .order('month', { ascending: false })
    .limit(1)
    .single();

  if (previous?.ai_credits_purchased) {
    carryForwardCredits = previous.ai_credits_purchased;
  }

  // Create new usage record for this month
  const { data: created, error } = await supabaseAdmin
    .from('usage')
    .insert({
      user_id: userId,
      month: currentMonth,
      ai_credits_purchased: carryForwardCredits,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create usage record: ${error.message}`);
  return created;
}

/** Increment deterministic image count for current month (atomic). */
export async function incrementDeterministicCount(userId: string) {
  const usage = await getOrCreateUsage(userId);
  const { data, error } = await supabaseAdmin.rpc('increment_usage_field', {
    row_id: usage.id,
    field_name: 'deterministic_count',
  });
  if (error) {
    // Fallback to non-atomic increment if RPC not yet deployed
    const { error: updateErr } = await supabaseAdmin
      .from('usage')
      .update({ deterministic_count: usage.deterministic_count + 1 })
      .eq('id', usage.id);
    if (updateErr) throw new Error(`Failed to increment usage: ${updateErr.message}`);
    return usage.deterministic_count + 1;
  }
  return data;
}

/** Increment AI usage count for current month (atomic). */
export async function incrementAICount(userId: string) {
  const usage = await getOrCreateUsage(userId);
  const { data, error } = await supabaseAdmin.rpc('increment_usage_field', {
    row_id: usage.id,
    field_name: 'ai_count',
  });
  if (error) {
    // Fallback to non-atomic increment if RPC not yet deployed
    const { error: updateErr } = await supabaseAdmin
      .from('usage')
      .update({ ai_count: usage.ai_count + 1 })
      .eq('id', usage.id);
    if (updateErr) throw new Error(`Failed to increment AI usage: ${updateErr.message}`);
    return usage.ai_count + 1;
  }
  return data;
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
