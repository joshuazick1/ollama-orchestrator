/**
 * constants/index.ts
 * Central export for constants
 */

export {
  API_ENDPOINTS,
  ANTHROPIC_SERVER_CAPABILITIES,
  type OllamaEndpoint,
  type OpenAIEndpoint,
  type AnthropicEndpoint,
} from './api-endpoints.js';
export { ERROR_MESSAGES, type ErrorMessageKey } from './error-messages.js';

export const PREFIX_HASH_DEFAULT_TOKEN_COUNT = 512;
