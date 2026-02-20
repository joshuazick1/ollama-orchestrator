// This utility centralizes JSON handling to prevent repeated inline usage
// and provides basic error handling for the parsing process.

/**
 * Safely parses a JSON string.
 * @param {string} jsonString - The string to parse.
 * @param {any} [fallback] - Optional fallback value if parsing fails.
 * @returns {any} The parsed object or the fallback value.
 */
export const safeJsonParse = (jsonString: string, fallback: any = null): any => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Failed to parse JSON string:', error);
    return fallback;
  }
};

/**
 * Converts a value to a JSON string.
 * @param {any} value - The value to stringify.
 * @returns {string} The JSON string representation.
 */
export const safeJsonStringify = (
  value: any,
  replacer?: (number | string)[] | ((this: any, key: string, value: any) => any) | null,
  space?: string | number
): string => {
  try {
    return JSON.stringify(value, replacer as any, space as any);
  } catch (error) {
    console.error('Failed to stringify value:', error);
    return '';
  }
};
