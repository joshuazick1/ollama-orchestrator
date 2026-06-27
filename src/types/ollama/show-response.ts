/**
 * show-response.ts
 * Response type for Ollama /api/show endpoint
 */

export interface OllamaShowResponse {
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    context_length?: number;
  };
  model_info?: Record<string, number | string | boolean>;
}
