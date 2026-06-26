/**
 * cohere.types.ts
 * Typed Cohere request/response schemas for the Chat API
 * API Spec: https://docs.cohere.com/
 */

import { z } from 'zod';

// =============================================================================
// Document Grounding Types
// =============================================================================

/**
 * A document for Cohere's RAG (document grounding) feature.
 * Each document has an ID, optional title, and snippet/content.
 */
export const CohereDocumentSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    snippet: z.string().optional(),
    data: z.string().optional(),
  })
  .passthrough();

export type CohereDocument = z.infer<typeof CohereDocumentSchema>;

// =============================================================================
// Citation Types
// =============================================================================

/**
 * Citation sources for generated text.
 */
export const CohereCitationSchema = z
  .object({
    start: z.number().int(),
    end: z.number().int(),
    text: z.string(),
    document_ids: z.array(z.string()).optional(),
  })
  .passthrough();

export type CohereCitation = z.infer<typeof CohereCitationSchema>;

/**
 * Citation options configuration.
 */
export const CohereCitationOptionsSchema = z
  .object({
    temperature: z.number().min(0).max(5).optional(),
    top_k: z.number().int().nonnegative().optional(),
    top_p: z.number().min(0).max(1).optional(),
    count: z.number().int().nonnegative().optional(),
    paragraphs: z.boolean().optional(),
    strategy: z.enum(['accurate', 'fast']).optional(),
  })
  .passthrough();

export type CohereCitationOptions = z.infer<typeof CohereCitationOptionsSchema>;

// =============================================================================
// Message Types
// =============================================================================

/**
 * Cohere message with role and content.
 * Cohere supports: user, assistant, system roles.
 */
export const CohereMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })
  .passthrough();

export type CohereMessage = z.infer<typeof CohereMessageSchema>;

// =============================================================================
// Request Types
// =============================================================================

/**
 * Cohere Chat request body.
 * API Reference: https://docs.cohere.com/reference/chat
 */
export const CohereChatRequestSchema = z
  .object({
    model: z.string().optional(),
    message: z.string().optional(),
    messages: z.array(CohereMessageSchema).optional(),
    documents: z.array(CohereDocumentSchema).optional(),
    citation_options: CohereCitationOptionsSchema.optional(),
    temperature: z.number().min(0).max(5).optional(),
    max_tokens: z.number().int().nonnegative().optional(),
    max_input_tokens: z.number().int().nonnegative().optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional().default(false),
    premise: z.string().optional(),
    search_queries_only: z.boolean().optional().default(false),
    connectors: z
      .array(
        z.object({
          type: z.string(),
          id: z.string().optional(),
        })
      )
      .optional(),
    conversation_id: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type CohereChatRequest = z.infer<typeof CohereChatRequestSchema>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Usage statistics in the response.
 */
export const CohereUsageSchema = z
  .object({
    input_tokens: z.number().int().optional(),
    output_tokens: z.number().int().optional(),
    total_tokens: z.number().int().optional(),
    response_tokens: z.number().int().optional(),
  })
  .passthrough();

export type CohereUsage = z.infer<typeof CohereUsageSchema>;

/**
 * Cohere Chat response body.
 */
export const CohereChatResponseSchema = z
  .object({
    response_id: z.string().optional(),
    text: z.string().optional(),
    generation_id: z.string().optional(),
    chat_history: z.array(CohereMessageSchema).optional(),
    citations: z.array(CohereCitationSchema).optional(),
    documents: z.array(CohereDocumentSchema).optional(),
    search_results: z
      .array(
        z.object({
          query: z.string().optional(),
          results: z.array(CohereDocumentSchema).optional(),
        })
      )
      .optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    finish_reason: z.enum(['COMPLETE', 'MAX_TOKENS', 'ERROR']).optional(),
    usage: CohereUsageSchema.optional(),
  })
  .passthrough();

export type CohereChatResponse = z.infer<typeof CohereChatResponseSchema>;

// =============================================================================
// Stream Event Types
// =============================================================================

/**
 * Stream start event.
 */
export const CohereStreamStartEventSchema = z
  .object({
    event: z.literal('stream-start'),
    generation_id: z.string().optional(),
  })
  .passthrough();

export type CohereStreamStartEvent = z.infer<typeof CohereStreamStartEventSchema>;

/**
 * Text generation delta event.
 */
export const CohereTextDeltaEventSchema = z
  .object({
    event: z.literal('text-generation'),
    text: z.string(),
  })
  .passthrough();

export type CohereTextDeltaEvent = z.infer<typeof CohereTextDeltaEventSchema>;

/**
 * Citation generation event.
 */
export const CohereCitationGenerationEventSchema = z
  .object({
    event: z.literal('citation-generation'),
    citations: z.array(CohereCitationSchema).optional(),
  })
  .passthrough();

export type CohereCitationGenerationEvent = z.infer<typeof CohereCitationGenerationEventSchema>;

/**
 * Stream end event.
 */
export const CohereStreamEndEventSchema = z
  .object({
    event: z.literal('stream-end'),
    generation_id: z.string().optional(),
    finish_reason: z.enum(['COMPLETE', 'MAX_TOKENS', 'ERROR']).optional(),
    usage: CohereUsageSchema.optional(),
    citations: z.array(CohereCitationSchema).optional(),
    search_results: z
      .array(
        z.object({
          query: z.string().optional(),
          results: z.array(CohereDocumentSchema).optional(),
        })
      )
      .optional(),
  })
  .passthrough();

export type CohereStreamEndEvent = z.infer<typeof CohereStreamEndEventSchema>;

/**
 * Stream error event.
 */
export const CohereStreamErrorEventSchema = z
  .object({
    event: z.literal('error'),
    error: z.object({
      message: z.string(),
      code: z.string().optional(),
    }),
  })
  .passthrough();

export type CohereStreamErrorEvent = z.infer<typeof CohereStreamErrorEventSchema>;
