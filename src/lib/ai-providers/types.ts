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

  /**
   * Analyze an image and return optimal parameters for the sharpening pipeline.
   * Returns structured JSON — no image generation, just vision analysis.
   */
  analyzeForSharpening(image: ImageInput): Promise<SharpenAnalysis>;
}

/**
 * AI-determined parameters for the sharpening pipeline.
 * All values are conservative by default to prevent over-processing.
 */
export interface SharpenAnalysis {
  noise_level: 'low' | 'medium' | 'high';
  blur_level: 'none' | 'slight' | 'moderate' | 'severe';
  denoise: { h: number; hColor: number; templateWindow: number; searchWindow: number };
  deconvolve: { strength: number; iterations: number; noise_reg: number };
  guided: { radius: number; eps: number };
  clahe: { clipLimit: number; tileGridSize: number; apply: boolean };
  ringing: { suppress: boolean; threshold: number };
  needs_ai_pass: boolean;
  ai_pass_prompt: string;
}

/** Supported provider names — must match BYOK provider column. */
export type ProviderName = 'gemini' | 'openai' | 'grok';
