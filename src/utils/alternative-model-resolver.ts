/**
 * alternative-model-resolver.ts
 * Resolves alternative models based on name similarity
 */

import type { AlternativeModel } from '../types/availability.types.js';

/**
 * Parse parameter size from model name.
 * Examples: "qwen2.5:7b-instruct-q4_K_M" -> "7b", "llama3:8b" -> "8b", "mistral:7b" -> "7b"
 */
function parseParameterSize(modelName: string): string | null {
  const match = modelName.match(/(?:^|:)(\d+(?:\.\d+)?b)/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Parse model family from model name.
 * Examples: "qwen2.5:7b-instruct-q4_K_M" -> "qwen2.5", "llama3:8b" -> "llama3"
 */
function parseModelFamily(modelName: string): string | null {
  const colonIndex = modelName.indexOf(':');
  if (colonIndex === -1) {
    const match = modelName.match(/^([a-z]+)/i);
    return match ? match[1].toLowerCase() : null;
  }
  const family = modelName.substring(0, colonIndex).toLowerCase();
  return family || null;
}

/**
 * Check if two model names share the same family prefix.
 */
function isSameFamily(model1: string, model2: string): boolean {
  const family1 = parseModelFamily(model1);
  const family2 = parseModelFamily(model2);
  if (!family1 || !family2) return false;
  return family1 === family2;
}

/**
 * Check if two models are the same family with different parameter sizes.
 */
function isSameFamilyDifferentSize(model1: string, model2: string): boolean {
  if (!isSameFamily(model1, model2)) return false;
  const size1 = parseParameterSize(model1);
  const size2 = parseParameterSize(model2);
  if (!size1 || !size2) return false;
  return size1 !== size2;
}

/**
 * Check if model2 starts with the same prefix as model1 (before the parameter size).
 */
function isSharedPrefix(model1: string, model2: string): boolean {
  const colonIndex = model1.indexOf(':');
  if (colonIndex === -1) return false;
  const prefix = model1.substring(0, colonIndex).toLowerCase();
  const family2 = parseModelFamily(model2);
  return family2 !== null && model2.toLowerCase().startsWith(prefix);
}

/**
 * Calculate similarity score between two models.
 * Higher score = better alternative.
 * Returns a similarity tag and whether the alternative is available.
 */
export function findAlternative(
  targetModel: string,
  candidateModel: string,
  isAvailable: boolean
): AlternativeModel | null {
  if (candidateModel === targetModel) return null;

  if (isSameFamilyDifferentSize(targetModel, candidateModel)) {
    return {
      model: candidateModel,
      similarity: 'same-family',
      available: isAvailable,
    };
  }

  if (isSameFamily(targetModel, candidateModel)) {
    return {
      model: candidateModel,
      similarity: 'same-parameter-size',
      available: isAvailable,
    };
  }

  if (isSharedPrefix(targetModel, candidateModel)) {
    return {
      model: candidateModel,
      similarity: 'shared-prefix',
      available: isAvailable,
    };
  }

  return null;
}

/**
 * Find all alternative models for a given target model.
 * Returns up to `maxAlternatives` alternatives sorted by priority.
 */
export function findAlternatives(
  targetModel: string,
  allModels: string[],
  availableModels: Set<string>,
  maxAlternatives: number = 5
): AlternativeModel[] {
  const alternatives: AlternativeModel[] = [];

  for (const candidate of allModels) {
    const alt = findAlternative(targetModel, candidate, availableModels.has(candidate));
    if (alt) {
      alternatives.push(alt);
    }
  }

  const priority = (alt: AlternativeModel): number => {
    switch (alt.similarity) {
      case 'same-family':
        return 0;
      case 'same-parameter-size':
        return 1;
      case 'shared-prefix':
        return 2;
      default:
        return 3;
    }
  };

  alternatives.sort((a, b) => {
    const prioDiff = priority(a) - priority(b);
    if (prioDiff !== 0) return prioDiff;
    if (a.available !== b.available) return a.available ? -1 : 1;
    return a.model.localeCompare(b.model);
  });

  return alternatives.slice(0, maxAlternatives);
}
