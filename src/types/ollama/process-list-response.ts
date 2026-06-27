/**
 * process-list-response.ts
 * Response types for Ollama /api/ps endpoint
 */

/** Individual process entry from Ollama /api/ps */
export interface OllamaProcessEntry {
  model?: string;
  name?: string;
  size_vram?: number;
  vram?: number;
}

/** Response shape from Ollama /api/ps endpoint */
export interface OllamaProcessListResponse {
  models?: OllamaProcessEntry[];
}
