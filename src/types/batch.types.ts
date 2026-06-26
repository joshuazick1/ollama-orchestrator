import { z } from 'zod';

export const BATCH_STATUS_VALUES = ['in_progress', 'ended', 'canceling'] as const;
export type BatchStatus = (typeof BATCH_STATUS_VALUES)[number];

export const BatchRequestSchema = z.object({
  custom_id: z.string(),
  params: z.record(z.string(), z.unknown()),
});
export type BatchRequest = z.infer<typeof BatchRequestSchema>;

export const BatchRequestCountsSchema = z.object({
  succeeded: z.number().int().nonnegative(),
  errored: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  expired: z.number().int().nonnegative(),
  processing: z.number().int().nonnegative(),
});
export type BatchRequestCounts = z.infer<typeof BatchRequestCountsSchema>;

export const BatchCreateRequestSchema = z.object({
  requests: z.array(BatchRequestSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type BatchCreateRequest = z.infer<typeof BatchCreateRequestSchema>;

export const BatchResponseSchema = z.object({
  id: z.string(),
  processing_status: z.enum(['in_progress', 'ended', 'canceling'] as const),
  request_counts: BatchRequestCountsSchema,
  created_at: z.string(),
  ended_at: z.string().nullable(),
  expires_at: z.string(),
  results_url: z.string().nullable(),
  type: z.literal('message_batch'),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type BatchResponse = z.infer<typeof BatchResponseSchema>;

export const BatchListResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(BatchResponseSchema),
  has_more: z.boolean(),
  first_id: z.string().nullable(),
  last_id: z.string().nullable(),
});
export type BatchListResponse = z.infer<typeof BatchListResponseSchema>;

export interface BatchResultItem {
  custom_id: string;
  result: Record<string, unknown>;
  error: {
    type: string;
    message: string;
  } | null;
}

export const BatchErrorSchema = z.object({
  type: z.string(),
  error: z.object({
    type: z.string(),
    message: z.string(),
    param: z.string().nullable().optional(),
  }),
});
export type BatchError = z.infer<typeof BatchErrorSchema>;

export interface BatchTrackingRecord {
  batch_id: string;
  status: BatchStatus;
  created_at: number;
  completed_at: number | null;
  expires_at: number | null;
  request_counts: BatchRequestCounts;
  metadata: Record<string, unknown> | null;
}
