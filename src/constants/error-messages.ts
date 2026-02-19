/**
 * error-messages.ts
 * Standardized error messages used across the codebase
 */

export const ERROR_MESSAGES = {
  // Server errors
  SERVER_NOT_FOUND: (id: string) => `Server '${id}' not found`,
  SERVER_NOT_FOUND_COLON: (id: string) => `Server not found: ${id}`,
  SERVER_NOT_FOUND_PLAIN: 'Server not found',
  SERVER_URL_NOT_FOUND: (id: string) => `Server URL not found for ${id}`,
  SERVER_NOT_HEALTHY: (id: string) => `Server is not healthy: ${id}`,
  SERVER_ALREADY_EXISTS: (id: string) => `Server '${id}' already exists`,
  SERVER_ID_AND_URL_REQUIRED: 'id and url are required',
  TARGET_SERVER_NOT_FOUND: (id: string) => `Target server '${id}' not found`,
  SOURCE_SERVER_NOT_FOUND: (id: string) => `Source server '${id}' not found`,

  // Model errors
  MODEL_NOT_FOUND: (model: string) => `model '${model}' not found`,
  MODEL_NOT_FOUND_ON_SERVER: (model: string) => `model '${model}' not found on any healthy server`,
  MODEL_REQUIRED: 'model is required',
  MODEL_REQUIRED_STRING: 'model is required and must be a string',
  MODEL_NOT_FOUND_ON_SOURCE: (model: string, serverId: string) =>
    `Model '${model}' not found on source server '${serverId}'`,
  PROMPT_REQUIRED: 'prompt is required',
  PROMPT_REQUIRED_FOR_GENERATION: 'prompt is required for generation',
  INPUT_OR_PROMPT_REQUIRED: 'input or prompt is required',

  // Circuit breaker errors
  CIRCUIT_BREAKER_NOT_FOUND: (serverId: string, model: string) =>
    `Circuit breaker not found for ${serverId}:${model}`,
  CIRCUIT_BREAKER_NOT_FOUND_KEY: (key: string) => `Circuit breaker not found for ${key}`,
  CIRCUIT_BREAKER_OPEN: (serverId: string, model: string) =>
    `Circuit breaker is open for ${serverId}:${model}`,
  CIRCUIT_BREAKER_NOT_FOUND_SERVER: (serverId: string) =>
    `Circuit breaker not found for server ${serverId}`,

  // Generic errors
  INTERNAL_SERVER_ERROR: 'Internal server error',
  INVALID_REQUEST: (field: string) => `${field} is required`,
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',

  // Queue errors
  QUEUE_PAUSED: 'Queue is paused',
  QUEUE_FULL: 'Queue is full',
  QUEUE_CLEARED: 'Queue cleared',
  QUEUE_SERVER_NOT_FOUND: (id: string) => `Server ${id} not found`,
} as const;

export type ErrorMessageKey = keyof typeof ERROR_MESSAGES;
