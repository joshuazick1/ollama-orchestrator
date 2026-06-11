import { logger } from './logger.js';

export function isObject(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

export function isArrayOf<T>(itemGuard: (obj: unknown) => obj is T): (obj: unknown) => obj is T[] {
  return (obj: unknown): obj is T[] => {
    return Array.isArray(obj) && obj.every(itemGuard);
  };
}

export function safeJsonParse<T>(
  raw: string,
  validator?: (obj: unknown) => obj is T,
  fallback?: T,
  context: string = 'json'
): T | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (validator && !validator(parsed)) {
      logger.warn(`JSON validation failed for ${context}, using fallback`);
      return fallback ?? null;
    }
    return (parsed as T) ?? fallback ?? null;
  } catch (err) {
    logger.warn(`JSON parse failed for ${context}, using fallback`, { error: err });
    return fallback ?? null;
  }
}

export const safeJsonStringify = (
  value: any,
  replacer?: (number | string)[] | ((this: any, key: string, value: any) => any) | null,
  space?: string | number
): string => {
  try {
    return JSON.stringify(value, replacer as any, space as any);
  } catch (error) {
    if (process.env.DEBUG === 'true') {
      logger.error('Failed to stringify value:', { error });
    }
    throw new Error(
      `safeJsonStringify failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};
