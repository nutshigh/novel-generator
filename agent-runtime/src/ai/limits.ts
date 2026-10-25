/**
 * Output token ceiling for a single model call.
 *
 * Reasoning models (for example DeepSeek) spend part of this budget on
 * thinking before emitting the answer, so this stays well above what the
 * requested prose or JSON itself needs.
 */
export const MAX_OUTPUT_TOKENS = 384_000;
