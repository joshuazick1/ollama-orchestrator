export type ValidateModelListResult = {
  valid: string[];
  errors: string[];
};

const MAX_MODEL_LENGTH = 256;
const MAX_MODELS = 1000;

const INVALID_CHAR_PATTERN = /[<>'"`;]/;

export function validateModelList(input: string): ValidateModelListResult {
  const errors: string[] = [];
  const valid: string[] = [];

  if (!input || input.trim() === '') {
    errors.push('Input is empty');
    return { valid: [], errors };
  }

  const rawEntries = input.split(/[,\n]/);

  const nonEmptyEntries = rawEntries.filter(e => e.trim() !== '');
  if (nonEmptyEntries.length > MAX_MODELS) {
    errors.push(`Model list exceeds ${MAX_MODELS} models`);
    return { valid: [], errors };
  }

  const seenLower = new Set<string>();

  for (const entry of rawEntries) {
    const trimmed = entry.trim();

    if (trimmed === '') {
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (seenLower.has(lower)) {
      continue;
    }

    if (trimmed.length > MAX_MODEL_LENGTH) {
      errors.push(`Model "${trimmed.slice(0, 50)}..." exceeds ${MAX_MODEL_LENGTH} characters`);
      continue;
    }

    if (INVALID_CHAR_PATTERN.test(trimmed)) {
      errors.push(`Warning: model "${trimmed}" contains potentially invalid characters`);
    }

    seenLower.add(lower);
    valid.push(trimmed);
  }

  return { valid, errors };
}
