export { ApiErrorInfo } from './types';

export class ApiError extends Error {
  public status?: number;
  public details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function normalizeError(error: unknown, fallbackMessage = 'An error occurred'): ApiError {
  if (isApiError(error)) {
    return error;
  }
  if (error instanceof Error) {
    return new ApiError(error.message, undefined, error);
  }
  return new ApiError(fallbackMessage, undefined, error);
}
