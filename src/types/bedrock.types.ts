import { z } from 'zod';

/**
 * Bedrock model inference types.
 */

export interface BedrockInvokeRequest {
  modelId: string;
  body: Record<string, unknown>;
}

export interface BedrockInvokeResponse {
  statusCode: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface BedrockStreamEvent {
  type: 'chunk' | 'error' | 'done';
  chunk?: {
    bytes?: Uint8Array;
    json?: Record<string, unknown>;
  };
  error?: {
    code: string;
    message: string;
  };
}

export const bedrockInvokeRequestSchema = z.object({
  modelId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});

export const bedrockInvokeResponseSchema = z.object({
  statusCode: z.number(),
  body: z.record(z.string(), z.unknown()),
  headers: z.record(z.string(), z.string()).optional(),
});

export type BedrockInvokeRequestInput = z.infer<typeof bedrockInvokeRequestSchema>;
export type BedrockInvokeResponseInput = z.infer<typeof bedrockInvokeResponseSchema>;
