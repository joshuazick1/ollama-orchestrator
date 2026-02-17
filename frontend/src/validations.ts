import { z } from 'zod';

// Server URL validation - must be a valid HTTP/HTTPS URL
export const serverUrlSchema = z
  .string()
  .min(1, 'Server URL is required')
  .url('Must be a valid URL')
  .refine(url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'Must be an HTTP or HTTPS URL');

// API key validation - allows plain key or "env:VARIABLE_NAME" format
export const apiKeySchema = z
  .string()
  .regex(
    /^(env:[A-Z_][A-Z0-9_]*|sk-[a-zA-Z0-9-_]*)?$/,
    'API key must be "env:VARIABLE_NAME" or start with "sk-"'
  )
  .optional();

// Add server form schema
export const addServerSchema = z.object({
  url: serverUrlSchema,
  maxConcurrency: z
    .number()
    .min(1, 'Concurrency must be at least 1')
    .max(100, 'Concurrency cannot exceed 100')
    .optional(),
  apiKey: apiKeySchema,
});

// Model name validation
export const modelNameSchema = z
  .string()
  .min(1, 'Model name is required')
  .max(100, 'Model name is too long')
  .regex(/^[a-zA-Z0-9\-_./:]+$/, 'Model name contains invalid characters');

// Configuration validation schemas
export const portSchema = z
  .number()
  .min(1, 'Port must be between 1 and 65535')
  .max(65535, 'Port must be between 1 and 65535');

export const hostSchema = z.string().min(1, 'Host is required').max(255, 'Host is too long');

export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

// Helper function to validate and get errors
export function validateForm<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): {
  success: boolean;
  data?: T;
  errors?: Record<string, string>;
} {
  try {
    const result = schema.parse(data);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors: Record<string, string> = {};
      error.issues.forEach(issue => {
        if (issue.path.length > 0) {
          errors[issue.path[0] as string] = issue.message;
        }
      });
      return { success: false, errors };
    }
    return { success: false, errors: { general: 'Validation failed' } };
  }
}
