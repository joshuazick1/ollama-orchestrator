/**
 * deepMerge.ts
 * Deep merge utility for configuration objects
 */

/**
 * Check if value is a plain object
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Deep merge objects
 * Arrays are replaced, not merged
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  if (!isPlainObject(source)) {
    return target;
  }

  const result: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      // Recursively merge objects
      result[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      // Replace value (including arrays and null)
      result[key] = sourceValue;
    }
  }

  return result;
}

/**
 * Deep merge multiple sources
 */
export function deepMergeAll(
  target: Record<string, unknown>,
  ...sources: Array<Record<string, unknown>>
): Record<string, unknown> {
  return sources.reduce((acc, source) => deepMerge(acc, source), target);
}
