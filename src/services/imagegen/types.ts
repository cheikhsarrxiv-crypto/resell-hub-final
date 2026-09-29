/**
 * AI-first listing workflow — image generation, Phase 1 (architecture
 * only). This project's own audit (see the "AGENT IA AUTONOME POUR CRÉER
 * UNE ANNONCE DE A À Z" task) found ZERO image-generation capability
 * anywhere in the codebase and no provider decided — this module exists
 * so a real provider can be plugged in later (an interchangeable
 * ImageGenerationProvider, exactly the same shape as SourcingProvider/
 * WebSearchProvider) WITHOUT inventing an API or a key now. See
 * ImageGenerationProviderRegistry's own comment: it returns an empty
 * list today, on purpose.
 *
 * A generated image must never be presented as a real product photo —
 * see GeneratedImageResult's own fields: `prompt`/`provider`/`model`/
 * `generatedAt` are always attached so a caller can never lose or hide
 * that provenance (mirrors ProductImage.sourceType/generationMetadata in
 * prisma/schema.prisma).
 */

export interface ImageGenerationRequest {
  /** The exact prompt to send — built ONLY from real, known product facts by the caller (never invented here). */
  prompt: string;
  /** Optional real reference image URL (e.g. a source photo) some providers can use for style/consistency. Never required. */
  referenceImageUrl?: string;
}

export interface GeneratedImageResult {
  url: string;
  provider: string;
  model: string;
  prompt: string;
  generatedAt: string;
}

export interface ImageGenerationErrorInfo {
  provider: string;
  message: string;
  kind: 'not_configured' | 'timeout' | 'rate_limit' | 'upstream_error' | 'unknown';
}

export type ImageGenerationOutcome =
  | { status: 'ok'; image: GeneratedImageResult }
  | { status: 'error'; error: ImageGenerationErrorInfo };

/**
 * Every image generation provider implements this — same isConfigured()
 * contract as SourcingProvider/WebSearchProvider, so a caller can always
 * skip a provider with no credentials cleanly rather than throwing.
 */
export interface ImageGenerationProvider {
  readonly name: string;
  readonly displayName: string;
  isConfigured(): boolean;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationOutcome>;
}
