/**
 * model-memory-budget.ts
 * Heuristic concurrency floor for each model based on VRAM footprint.
 * Not a precise calculation — just a look-up table of known-good floors
 * for the top-25 fleet models. Unknown models fall back to 4.
 */

import { logger } from '../utils/logger.js';

export const MODEL_MEMORY_FLOOR_TABLE: Record<string, number> = {
  'smollm2:135m': 8,
  'smollm2:360m': 6,
  'qwen3:0.6b': 6,
  'qwen3:1.7b': 4,
  'qwen3:4b': 3,
  'qwen3:8b': 2,
  'qwen2.5:7b': 2,
  'llama3.2:1b': 4,
  'llama3.2:3b': 3,
  'llama3.1:8b': 2,
  'gemma3:4b': 3,
  'gemma3:12b': 2,
  'nomic-embed-text': 4,
  'mxbai-embed-large': 4,
  'phi3:mini': 3,
  'phi3:medium': 2,
  'deepseek-r1:1.5b': 4,
  'deepseek-r1:7b': 2,
  'mistral:7b': 2,
  'codellama:7b': 2,
  'dolphin-mistral:7b': 2,
  'mistral-nemo:12b': 2,
  'llava:7b': 2,
  'moondream:1.8b': 4,
  'granite3.1-dense:2b': 4,
}

const DEFAULT_MAX_CONCURRENCY = 4

export function modelMemoryFloor(modelName: string): number {
  const floor = MODEL_MEMORY_FLOOR_TABLE[modelName]
  if (floor !== undefined) {
    return floor
  }
  logger.debug(`[modelMemoryFloor] No floor entry for model "${modelName}", using default ${DEFAULT_MAX_CONCURRENCY}`)
  return DEFAULT_MAX_CONCURRENCY
}
