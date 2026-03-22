/**
 * prompt-estimator.ts
 * Utilities for estimating prompt token counts and managing context limits
 */

/**
 * Estimate the number of tokens in a text prompt.
 * Uses a simple character-based estimation (approximately 4 chars per token for English).
 * This is a rough approximation - actual token counts vary by model and tokenization.
 *
 * For more accurate counts, a real tokenizer like tiktoken would be needed,
 * but that adds latency and complexity.
 */
export function estimatePromptTokens(prompt: string): number {
  if (!prompt || typeof prompt !== 'string') {
    return 0;
  }

  // Remove leading/trailing whitespace
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return 0;
  }

  // Character-based estimation: average ~4 chars per English token
  // Add buffer for safety (use 3.5 to slightly overestimate)
  const estimatedTokens = Math.ceil(trimmed.length / 3.5);

  // Minimum of 1 token for non-empty prompts
  return Math.max(1, estimatedTokens);
}

/**
 * Estimate tokens for a chat message format.
 * Counts content from all messages.
 */
export function estimateChatTokens(messages: Array<{ role?: string; content?: string }>): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 0;
  }

  let totalTokens = 0;

  for (const msg of messages) {
    if (msg.content) {
      totalTokens += estimatePromptTokens(msg.content);
    }
    // Add overhead for role annotations (~1-2 tokens per message)
    if (msg.role) {
      totalTokens += 2;
    }
  }

  return totalTokens;
}

/**
 * Default context window sizes by model family (fallback when unknown).
 * These are rough estimates for common open-source models.
 */
const DEFAULT_CONTEXT_SIZES: Record<string, number> = {
  // Llama family
  llama: 4096,
  llama2: 4096,
  llama3: 8192,
  'llama3.1': 128,
  'llama3.2': 8192,
  codellama: 4096,
  'llama3.1:8b': 128,
  'llama3.1:70b': 128,
  'llama3.1:405b': 128,

  // Mistral family
  mistral: 8192,
  mixtral: 32768,
  'mistral-nemo': 128,
  'mistral-large': 128,

  // Phi family
  phi: 2048,
  phi3: 4096,
  'phi3.5': 4096,

  // Gemma family
  gemma: 8192,
  gemma2: 8192,

  // General defaults
  default: 4096,
};

/**
 * Get default context size for a model based on its name.
 * Used as fallback when we don't have explicit context limit data.
 */
export function getDefaultContextSize(modelName: string): number {
  const lowerName = modelName.toLowerCase();

  // Check exact and partial matches
  for (const [prefix, size] of Object.entries(DEFAULT_CONTEXT_SIZES)) {
    if (lowerName.includes(prefix)) {
      return size;
    }
  }

  return DEFAULT_CONTEXT_SIZES['default'];
}

/**
 * Check if a model's context limit can handle a prompt.
 * Returns true if context limit >= estimated prompt tokens.
 */
export function canHandleContext(
  contextLimit: number | undefined,
  estimatedTokens: number,
  modelName: string
): boolean {
  // If no context limit known, use default and assume it might work
  const effectiveLimit = contextLimit ?? getDefaultContextSize(modelName);

  // Add 10% buffer for response generation (model needs room to generate)
  const effectiveWithBuffer = Math.floor(effectiveLimit * 0.9);

  return estimatedTokens <= effectiveWithBuffer;
}
