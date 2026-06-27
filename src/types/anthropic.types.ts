/**
 * anthropic.types.ts
 * Typed Anthropic request/response schemas for the Messages API
 * API Spec: https://docs.anthropic.com/en/api/messages
 * SDK Reference: https://github.com/anthropics/anthropic-sdk-typescript
 */

import { z } from 'zod';

// =============================================================================
// Image Source Types
// =============================================================================

/**
 * Base64-encoded image source
 */
export const AnthropicImageSourceBase64Schema = z
  .object({
    type: z.literal('base64'),
    media_type: z.string(),
    data: z.string(),
  })
  .passthrough();

export type AnthropicImageSourceBase64 = z.infer<typeof AnthropicImageSourceBase64Schema>;

/**
 * URL image source
 */
export const AnthropicImageSourceUrlSchema = z
  .object({
    type: z.literal('url'),
    url: z.string(),
    media_type: z.string().optional(),
  })
  .passthrough();

export type AnthropicImageSourceUrl = z.infer<typeof AnthropicImageSourceUrlSchema>;

/**
 * Image source (base64 or url)
 */
export const AnthropicImageSourceSchema = z.discriminatedUnion('type', [
  AnthropicImageSourceBase64Schema,
  AnthropicImageSourceUrlSchema,
]);

export type AnthropicImageSource = z.infer<typeof AnthropicImageSourceSchema>;

// =============================================================================
// Content Block Types
// =============================================================================

/**
 * Text content block
 */
export const AnthropicTextBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .passthrough();

export type AnthropicTextBlock = z.infer<typeof AnthropicTextBlockSchema>;

/**
 * Image content block
 */
export const AnthropicImageBlockSchema = z
  .object({
    type: z.literal('image'),
    source: AnthropicImageSourceSchema,
  })
  .passthrough();

export type AnthropicImageBlock = z.infer<typeof AnthropicImageBlockSchema>;

/**
 * Tool use content block
 */
export const AnthropicToolUseBlockSchema = z
  .object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type AnthropicToolUseBlock = z.infer<typeof AnthropicToolUseBlockSchema>;

/**
 * Tool result content block
 */
export const AnthropicToolResultBlockSchema = z
  .object({
    type: z.literal('tool_result'),
    tool_use_id: z.string(),
    content: z.string(),
    is_error: z.boolean().optional(),
  })
  .passthrough();

export type AnthropicToolResultBlock = z.infer<typeof AnthropicToolResultBlockSchema>;

/**
 * Thinking content block (for extended thinking mode)
 */
export const AnthropicThinkingBlockSchema = z
  .object({
    type: z.literal('thinking'),
    thinking: z.string(),
    signature: z.string().optional(),
  })
  .passthrough();

export type AnthropicThinkingBlock = z.infer<typeof AnthropicThinkingBlockSchema>;

/**
 * Discriminated union of all Anthropic content block types
 */
export const AnthropicContentBlockSchema = z.discriminatedUnion('type', [
  AnthropicTextBlockSchema,
  AnthropicImageBlockSchema,
  AnthropicToolUseBlockSchema,
  AnthropicToolResultBlockSchema,
  AnthropicThinkingBlockSchema,
]);

export type AnthropicContentBlock = z.infer<typeof AnthropicContentBlockSchema>;

// =============================================================================
// Message Types
// =============================================================================

/**
 * Anthropic message with role and content
 */
export const AnthropicMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.union([z.string(), z.array(AnthropicContentBlockSchema)]),
  })
  .passthrough();

export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>;

// =============================================================================
// Cache Control
// =============================================================================

/**
 * Cache control for ephemeral caching
 */
export const AnthropicCacheControlSchema = z
  .object({
    type: z.literal('ephemeral'),
  })
  .passthrough();

export type AnthropicCacheControl = z.infer<typeof AnthropicCacheControlSchema>;

// =============================================================================
// System Prompt Types
// =============================================================================

/**
 * Text block for system prompt (used in array form).
 * Supports optional cache_control for ephemeral caching.
 */
export const AnthropicSystemTextBlockSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    cache_control: AnthropicCacheControlSchema.optional(),
  })
  .passthrough();

export type AnthropicSystemTextBlock = z.infer<typeof AnthropicSystemTextBlockSchema>;

/**
 * System prompt can be a plain string or an array of text blocks
 */
export const AnthropicSystemPromptSchema = z.union([
  z.string(),
  z.array(AnthropicSystemTextBlockSchema),
]);

export type AnthropicSystemPrompt = z.infer<typeof AnthropicSystemPromptSchema>;

// =============================================================================
// Tool Types
// =============================================================================

/**
 * JSON Schema representation for tool input schemas
 * Uses z.record(z.string(), z.unknown()) as no specific JSON schema lib is available
 * Note: In Zod v4, records accept additional properties by default
 */
export const AnthropicInputSchemaSchema = z.record(z.string(), z.unknown());

export type AnthropicInputSchema = z.infer<typeof AnthropicInputSchemaSchema>;

/**
 * Anthropic tool definition
 */
export const AnthropicToolSchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    input_schema: AnthropicInputSchemaSchema,
  })
  .passthrough();

export type AnthropicTool = z.infer<typeof AnthropicToolSchema>;

/**
 * Tool choice configuration
 */
export const AnthropicToolChoiceSchema = z
  .object({
    type: z.enum(['auto', 'any', 'tool']),
    name: z.string().optional(),
  })
  .passthrough();

export type AnthropicToolChoice = z.infer<typeof AnthropicToolChoiceSchema>;

// =============================================================================
// Thinking Configuration
// =============================================================================

/**
 * Extended thinking configuration
 */
export const AnthropicThinkingConfigSchema = z
  .object({
    type: z.enum(['enabled', 'disabled']),
    budget_tokens: z.number().int().positive().optional(),
  })
  .passthrough();

export type AnthropicThinkingConfig = z.infer<typeof AnthropicThinkingConfigSchema>;

// =============================================================================
// Request Types
// =============================================================================

/**
 * Main Messages API request body
 */
export const AnthropicMessagesRequestSchema = z
  .object({
    model: z.string(),
    messages: z.array(AnthropicMessageSchema),
    system: AnthropicSystemPromptSchema.optional(),
    max_tokens: z.number().int().positive(),
    tools: z.array(AnthropicToolSchema).optional(),
    tool_choice: AnthropicToolChoiceSchema.optional(),
    thinking: AnthropicThinkingConfigSchema.optional(),
    cache_control: AnthropicCacheControlSchema.optional(),
    temperature: z.number().min(0).max(1).optional(),
    top_p: z.number().min(0).max(1).optional(),
    top_k: z.number().int().nonnegative().optional(),
    stop_sequences: z.array(z.string()).optional(),
    stream: z.boolean().optional().default(false),
    metadata: z.record(z.string(), z.unknown()).optional(),
    stream_options: z
      .object({
        include_usage: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type AnthropicMessagesRequest = z.infer<typeof AnthropicMessagesRequestSchema>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Usage statistics in the response
 */
export const AnthropicUsageSchema = z
  .object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
    cache_creation_input_tokens: z.number().int().optional(),
    cache_read_input_tokens: z.number().int().optional(),
  })
  .passthrough();

export type AnthropicUsage = z.infer<typeof AnthropicUsageSchema>;

/**
 * Main Messages API response body
 */
export const AnthropicMessagesResponseSchema = z
  .object({
    id: z.string(),
    type: z.literal('message'),
    role: z.literal('assistant'),
    content: z.array(AnthropicContentBlockSchema),
    model: z.string(),
    stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use']),
    stop_sequence: z.string().optional(),
    usage: AnthropicUsageSchema,
  })
  .passthrough();

export type AnthropicMessagesResponse = z.infer<typeof AnthropicMessagesResponseSchema>;

// =============================================================================
// Stream Event Types
// =============================================================================

/**
 * message_start event - first event when a message begins
 */
export const AnthropicMessageStartEventSchema = z
  .object({
    type: z.literal('message_start'),
    message: z
      .object({
        id: z.string(),
        type: z.literal('message'),
        role: z.literal('assistant'),
        model: z.string(),
        content: z.array(AnthropicContentBlockSchema).optional(),
        stop_reason: z.string().nullable().optional(),
        stop_sequence: z.string().nullable().optional(),
        usage: AnthropicUsageSchema.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type AnthropicMessageStartEvent = z.infer<typeof AnthropicMessageStartEventSchema>;

/**
 * content_block_start event - when a content block begins
 */
export const AnthropicContentBlockStartEventSchema = z
  .object({
    type: z.literal('content_block_start'),
    index: z.number().int(),
    content_block: z.union([
      AnthropicTextBlockSchema,
      AnthropicImageBlockSchema,
      AnthropicToolUseBlockSchema,
      AnthropicThinkingBlockSchema,
    ]),
  })
  .passthrough();

export type AnthropicContentBlockStartEvent = z.infer<typeof AnthropicContentBlockStartEventSchema>;

/**
 * content_block_delta event - incremental updates to content blocks
 */
export const AnthropicContentBlockDeltaEventSchema = z
  .object({
    type: z.literal('content_block_delta'),
    index: z.number().int(),
    delta: z.union([
      z.object({
        type: z.literal('text_delta'),
        text: z.string(),
      }),
      z.object({
        type: z.literal('thinking_delta'),
        thinking: z.string(),
      }),
      z.object({
        type: z.literal('input_json_delta'),
        partial_json: z.string(),
      }),
    ]),
  })
  .passthrough();

export type AnthropicContentBlockDeltaEvent = z.infer<typeof AnthropicContentBlockDeltaEventSchema>;

/**
 * content_block_stop event - when a content block ends
 */
export const AnthropicContentBlockStopEventSchema = z
  .object({
    type: z.literal('content_block_stop'),
    index: z.number().int(),
  })
  .passthrough();

export type AnthropicContentBlockStopEvent = z.infer<typeof AnthropicContentBlockStopEventSchema>;

/**
 * message_delta event - final updates to message delta
 */
export const AnthropicMessageDeltaEventSchema = z
  .object({
    type: z.literal('message_delta'),
    delta: z
      .object({
        stop_reason: z.string().nullable().optional(),
        stop_sequence: z.string().nullable().optional(),
      })
      .passthrough(),
    usage: AnthropicUsageSchema.optional(),
  })
  .passthrough();

export type AnthropicMessageDeltaEvent = z.infer<typeof AnthropicMessageDeltaEventSchema>;

/**
 * message_stop event - final event when message is complete
 */
export const AnthropicMessageStopEventSchema = z
  .object({
    type: z.literal('message_stop'),
  })
  .passthrough();

export type AnthropicMessageStopEvent = z.infer<typeof AnthropicMessageStopEventSchema>;

/**
 * ping event - heartbeat for keep-alive
 */
export const AnthropicPingEventSchema = z
  .object({
    type: z.literal('ping'),
  })
  .passthrough();

export type AnthropicPingEvent = z.infer<typeof AnthropicPingEventSchema>;

/**
 * error event - indicates an error occurred
 */
export const AnthropicErrorEventSchema = z
  .object({
    type: z.literal('error'),
    error: z
      .object({
        type: z.string(),
        message: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

export type AnthropicErrorEvent = z.infer<typeof AnthropicErrorEventSchema>;

/**
 * Union of all Anthropic stream event types
 */
export const AnthropicStreamEventSchema = z.discriminatedUnion('type', [
  AnthropicMessageStartEventSchema,
  AnthropicContentBlockStartEventSchema,
  AnthropicContentBlockDeltaEventSchema,
  AnthropicContentBlockStopEventSchema,
  AnthropicMessageDeltaEventSchema,
  AnthropicMessageStopEventSchema,
  AnthropicPingEventSchema,
  AnthropicErrorEventSchema,
]);

export type AnthropicStreamEvent = z.infer<typeof AnthropicStreamEventSchema>;
