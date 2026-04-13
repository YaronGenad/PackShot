/**
 * AI Provider adapter interface — unified API for all AI image generation backends.
 * Each provider implements these three operations with provider-specific SDK calls.
 */

/** Image input — base64 encoded image data. */
export interface ImageInput {
  base64: string;
  mimeType: string;
  name?: string;
}

/** Result from any AI operation — always a data URL. */
export interface AIResult {
  image: string; // data:image/...;base64,...
}

/**
 * Unified AI provider interface.
 * All providers must implement these three operations.
 */
export interface AIProvider {
  /** Provider identifier. */
  readonly name: string;

  /** Human-readable display name. */
  readonly displayName: string;

  /**
   * Generate a studio packshot from source images.
   * Pure white background, zero creativity, exact product fidelity.
   */
  generatePackshot(images: ImageInput[]): Promise<AIResult>;

  /**
   * Homogenize lighting — reduce burnt highlights, lift dark shadows.
   */
  homogenize(
    currentImage: string,
    sourceImages: ImageInput[],
    burnt: number,
    dark: number
  ): Promise<AIResult>;

  /**
   * Apply a targeted edit via user prompt (e.g. "change cap to red").
   */
  editImage(
    currentImage: string,
    sourceImages: ImageInput[],
    prompt: string
  ): Promise<AIResult>;
}

/** Supported provider names — must match BYOK provider column. */
export type ProviderName = 'gemini' | 'openai' | 'grok';
