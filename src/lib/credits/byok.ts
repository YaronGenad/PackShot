/**
 * BYOK (Bring Your Own Key) — encrypted storage and retrieval of user AI provider keys.
 * Keys are encrypted at rest with AES-256-CBC using a server secret.
 */

import crypto from 'crypto';
import { supabaseAdmin } from '../db/supabase.js';

/** Supported AI providers. */
export type AIProvider = 'gemini' | 'openai' | 'grok' | 'flux';

/** Get encryption key from env. Throws in production if not set. */
function getEncryptionKey(): Buffer {
  const key = process.env.BYOK_ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BYOK_ENCRYPTION_KEY is required in production');
    }
    // Dev-only fallback — generates a deterministic key for local development
    return crypto.createHash('sha256').update('packshot-dev-key-NOT-FOR-PRODUCTION').digest();
  }
  return Buffer.from(key, 'hex');
}

/** Encrypt a plaintext API key. Returns "iv:encrypted" hex string. */
export function encryptKey(plainKey: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getEncryptionKey(), iv);
  let encrypted = cipher.update(plainKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

/** Decrypt an encrypted API key. */
export function decryptKey(encryptedKey: string): string {
  const [ivHex, data] = encryptedKey.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Store a BYOK key for a user+provider (upsert).
 * Key is encrypted before storage.
 */
export async function storeBYOKKey(
  userId: string,
  provider: AIProvider,
  plainKey: string
): Promise<void> {
  const encrypted = encryptKey(plainKey);

  const { error } = await supabaseAdmin
    .from('user_ai_keys')
    .upsert(
      {
        user_id: userId,
        provider,
        encrypted_key: encrypted,
      },
      { onConflict: 'user_id,provider' }
    );

  if (error) throw new Error(`Failed to store BYOK key: ${error.message}`);
}

/**
 * Get decrypted BYOK key for a user+provider.
 * Returns null if no key stored.
 */
export async function getUserBYOKKey(
  userId: string,
  provider: AIProvider
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('user_ai_keys')
    .select('encrypted_key')
    .eq('user_id', userId)
    .eq('provider', provider)
    .single();

  if (!data) return null;

  try {
    return decryptKey(data.encrypted_key);
  } catch {
    return null; // Corrupted key — treat as missing
  }
}

/**
 * List all BYOK providers a user has keys for (never returns actual keys).
 */
export async function listUserBYOKProviders(userId: string): Promise<{
  provider: AIProvider;
  created_at: string;
}[]> {
  const { data } = await supabaseAdmin
    .from('user_ai_keys')
    .select('provider, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  return (data || []) as { provider: AIProvider; created_at: string }[];
}

/**
 * Delete a BYOK key for a user+provider.
 */
export async function deleteBYOKKey(
  userId: string,
  provider: AIProvider
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_ai_keys')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);

  if (error) throw new Error(`Failed to delete BYOK key: ${error.message}`);
}
