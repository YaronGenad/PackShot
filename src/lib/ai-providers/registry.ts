/**
 * AI Provider registry — creates the correct provider instance per request.
 *
 * Resolution order:
 * 1. User's preferred provider (if set and BYOK key available)
 * 2. Any available BYOK key
 * 3. Default: Gemini with PackShot's server key (costs credits)
 */

import type { AIProvider, ProviderName } from './types.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import { GrokProvider } from './grok.js';

/** Create a provider instance from name + API key. */
export function createProvider(name: ProviderName, apiKey: string): AIProvider {
  switch (name) {
    case 'gemini':
      return new GeminiProvider(apiKey);
    case 'openai':
      return new OpenAIProvider(apiKey);
    case 'grok':
      return new GrokProvider(apiKey);
    default:
      throw new Error(`Unknown AI provider: ${name}`);
  }
}

/** All supported provider names for display. */
export const PROVIDER_INFO: Record<ProviderName, { displayName: string; description: string }> = {
  gemini: {
    displayName: 'Google Gemini',
    description: 'Gemini 3.1 Flash Image — fast, high-quality image generation',
  },
  openai: {
    displayName: 'OpenAI',
    description: 'GPT-4o vision + GPT Image 1 — powerful multimodal understanding',
  },
  grok: {
    displayName: 'xAI Grok',
    description: 'Grok 2 Vision + Aurora — xAI image generation',
  },
};

/**
 * Resolve which provider to use for a request.
 * Called from the checkAICredits middleware or directly by endpoints.
 *
 * @param byokKeys - Map of provider -> decrypted API key
 * @param preferredProvider - User's preferred provider (from settings/request)
 * @param serverGeminiKey - PackShot's Gemini key (fallback)
 * @returns { provider: AIProvider, providerName: ProviderName, usingBYOK: boolean }
 */
export function resolveProvider(
  byokKeys: Map<string, string>,
  preferredProvider: ProviderName | null,
  serverGeminiKey: string
): { provider: AIProvider; providerName: ProviderName; usingBYOK: boolean } {
  // 1. Preferred provider with BYOK key
  if (preferredProvider && byokKeys.has(preferredProvider)) {
    return {
      provider: createProvider(preferredProvider, byokKeys.get(preferredProvider)!),
      providerName: preferredProvider,
      usingBYOK: true,
    };
  }

  // 2. Any available BYOK key (prefer gemini > openai > grok)
  const priority: ProviderName[] = ['gemini', 'openai', 'grok'];
  for (const name of priority) {
    if (byokKeys.has(name)) {
      return {
        provider: createProvider(name, byokKeys.get(name)!),
        providerName: name,
        usingBYOK: true,
      };
    }
  }

  // 3. Fallback: PackShot's Gemini key (costs credits)
  if (!serverGeminiKey) {
    throw new Error('No AI provider available. Add your own API key or buy credits.');
  }
  return {
    provider: new GeminiProvider(serverGeminiKey),
    providerName: 'gemini',
    usingBYOK: false,
  };
}
