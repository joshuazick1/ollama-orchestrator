/**
 * generate-response.ts
 * Response type for Ollama /api/generate endpoint
 */

export interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
}
