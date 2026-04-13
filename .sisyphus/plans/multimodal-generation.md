# Multimodal Generation Support: Image, Audio (TTS), and Video

## TL;DR

> **Quick Summary**: Add provider-agnostic support for image generation, text-to-speech (TTS), and video generation to the ollama-orchestrator. Routed through existing `/v1/*` endpoints with capability-based server selection, request/response normalization, and async task tracking.
>
> **Deliverables**:
> - TTS support via `POST /v1/audio/speech` (OpenAI-compatible) routing to MiniMax `/v1/t2a_v2` or OpenAI `/v1/audio/speech`
> - Image generation via `POST /v1/images/generations` routing to MiniMax `/v1/image_generation` or OpenAI `/v1/images/generations`
> - Video generation via `POST /v1/video/generations` with async task polling
> - Provider-agnostic endpoint routing via `endpointOverrides`
> - Exponential backoff polling for async operations
> - Per-provider circuit breakers and concurrency limits
>
> **Estimated Effort**: XL (50+ tasks across 5 waves)
> **Parallel Execution**: YES - up to 8 tasks per wave
> **Critical Path**: T1-T3 (types/schema) → T10-T12 (infrastructure) → T20-T21 (TTS) → T30-T31 (Images) → T40-T42 (Video) → F1-F4

---

## Context

### Original Request
User requested: "Let's look into adding image and audio generation support to endpoints like minimax."

### Research Findings

#### 1. Orchestrator Architecture
The orchestrator has two parallel routing systems:
- **Ollama-Native** (`/api/*`): `ollama-controller.ts`
- **OpenAI-Compatible** (`/v1/*`): `openai-controller.ts`

Server capabilities detected via health-check-scheduler probes 7 endpoints:
```
Ollama: /api/chat, /api/generate, /api/embeddings
OpenAI: /v1/chat/completions, /v1/completions, /v1/embeddings
Anthropic: /v1/messages
```

Results stored in `AIServer.probedEndpoints` and aggregate flags (`supportsV1`, `supportsOllama`, `supportsAnthropic`).

#### 2. MiniMax APIs
| Modality | Endpoint | Models | Async |
|----------|----------|--------|-------|
| Text-to-Speech | `POST /v1/t2a_v2` | speech-2.8-hd/turbo, speech-2.6-hd/turbo, speech-02-hd/turbo | Sync (or streaming) |
| Image Generation | `POST /v1/image_generation` | image-01 | Sync |
| Video Generation | `POST /v1/video_generation` + `GET /v1/query/video_generation` | MiniMax-Hailuo-2.3, Hailuo-02 | Async |
| Music Generation | `POST /v1/music_generation` | music-2.6 | Async |

#### 3. OpenAI APIs
| Modality | Endpoint | Models |
|----------|----------|--------|
| Images | `POST /v1/images/generations` | gpt-image-1.5, dall-e-3, dall-e-2 |
| Audio/TTS | `POST /v1/audio/speech` | gpt-4o-mini-tts, tts-1, tts-1-hd |

#### 4. Industry Best Practices

**Async Polling Intervals (from research)**:
| Modality | Initial Poll | Interval Growth | Timeout |
|----------|-------------|-----------------|---------|
| Image (fast) | 500ms | 1.5x | 60s |
| Image (slow) | 2000ms | 1.5x | 120s |
| Video | 2000ms | 1.5x | 5min |
| Long-running | 5000ms | 1.5x | 10min |

**Key Pattern**: Exponential backoff with **jitter** is mandatory to prevent thundering herd.

**Circuit Breakers**: Per-provider isolation, never global. 3-state machine (Closed → Open → Half-Open).

**Concurrency**: Two-tier approach - Semaphore (local concurrency) + Token Bucket (API quota/RPM).

### Metis Review Findings

**Identified Gaps**:
1. Missing capability flags for images/audio/video on AIServer type
2. Need async task tracking infrastructure
3. Need exponential backoff utility with jitter
4. Need per-provider circuit breakers
5. Missing health check probes for multimodal endpoints

**Required Design Decisions**:
1. Storage backend for async tasks (in-memory vs Redis)
2. Provider scope for v1 (MiniMax + OpenAI minimum)
3. Cost tracking scope
4. Max file size limits
5. Streaming support required or poll-only

---

## Work Objectives

### Core Objective
Add multimodal generation support (TTS, Images, Video) to the ollama-orchestrator in a provider-agnostic way, using OpenAI-compatible endpoints with provider-specific routing via `endpointOverrides`.

### Concrete Deliverables

#### Wave 1: Foundation & Schema Extensions
- [ ] `AIServer` type extended with `supportsImages`, `supportsAudio`, `supportsVideo`
- [ ] `endpointOverrides` extended with multimodal paths
- [ ] `AsyncTask` interface defined for task tracking
- [ ] `AsyncTaskStore` in-memory store with CRUD operations
- [ ] Exponential backoff utility with jitter

#### Wave 2: Infrastructure
- [ ] Circuit breaker implementation (per-provider)
- [ ] Concurrency limiter (semaphore per provider)
- [ ] Error normalization utilities (provider → standard format)
- [ ] Health check scheduler extended for multimodal probes
- [ ] Request transformation utilities (OpenAI → MiniMax format)

#### Wave 3: TTS Implementation
- [ ] `POST /v1/audio/speech` handler in openai-controller
- [ ] MiniMax TTS adapter (transforms `/v1/t2a_v2` request/response)
- [ ] OpenAI TTS adapter (pass-through)
- [ ] Async task creation and polling endpoints
- [ ] Unit tests for TTS handlers and adapters

#### Wave 4: Image Generation Implementation
- [ ] `POST /v1/images/generations` handler in openai-controller
- [ ] MiniMax image adapter (transforms `/v1/image_generation` request/response)
- [ ] OpenAI image adapter (pass-through)
- [ ] Image URL result handling (with expiration tracking)
- [ ] Unit tests for image handlers and adapters

#### Wave 5: Video Generation Implementation
- [ ] `POST /v1/video/generations` handler in openai-controller
- [ ] `GET /v1/tasks/:taskId` polling endpoint
- [ ] MiniMax video adapter (submit + poll pattern)
- [ ] Video result download handling
- [ ] Unit tests for video handlers and adapters

#### Wave 6: Integration & Frontend
- [ ] OpenAPI schema updated for multimodal endpoints
- [ ] Frontend AddServer modal updated with multimodal options
- [ ] Server detail view shows multimodal capabilities
- [ ] Integration tests with mock providers

#### Wave FINAL: Verification
- [ ] F1: Plan compliance audit (oracle)
- [ ] F2: Code quality review
- [ ] F3: Real manual QA
- [ ] F4: Scope fidelity check

### Definition of Done

#### TTS
- [ ] `curl -X POST http://localhost:5100/v1/audio/speech -d '{"model":"speech-2.8-hd","input":"Hello","voice":"English_Graceful_Lady"}'` returns audio data
- [ ] Task polling works: `GET /v1/tasks/:taskId` returns status
- [ ] MiniMax TTS returns same response format as OpenAI

#### Image Generation
- [ ] `curl -X POST http://localhost:5100/v1/images/generations -d '{"model":"image-01","prompt":"A red car"}'` returns image URL
- [ ] Multiple images work: `"n": 3` returns 3 URLs
- [ ] Aspect ratio options work

#### Video Generation
- [ ] `POST /v1/video/generations` returns task_id immediately (202)
- [ ] `GET /v1/tasks/:taskId` returns COMPLETED with video URL
- [ ] Polling respects exponential backoff

### Must Have
- Provider-agnostic routing (OpenAI format in, provider-specific out)
- Exponential backoff with jitter for all polling
- Per-provider circuit breakers (not global)
- Concurrency limits per provider
- Error normalization (provider errors → standard format)
- All endpoints require authentication

### Must NOT Have (Guardrails)
- No global circuit breaker (per-provider only)
- No result caching (client downloads immediately, URLs expire)
- No complex task graphs/workflows (single task per request)
- No webhook callbacks (polling is sufficient)
- No music generation (deferred)
- No speech-to-text (MiniMax doesn't have this)
- No custom circuit breaker implementation (use existing patterns)

---

## Verification Strategy

### Test Infrastructure
- **Infrastructure exists**: YES (vitest + integration tests)
- **Approach**: Tests-after for new controllers, integration tests for end-to-end flow
- **Framework**: vitest with supertest for API tests, msw for mocking providers

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

---

## Execution Strategy

### Wave 1: Foundation & Schema Extensions (5 tasks)

```
Wave 1 (Start Immediately - foundation + scaffolding):
├── T1: Extend AIServer type with multimodal capability flags [quick]
├── T2: Extend endpointOverrides schema for multimodal paths [quick]
├── T3: Define AsyncTask interface and states [quick]
├── T4: Implement AsyncTaskStore in-memory [quick]
└── T5: Implement exponential backoff utility with jitter [quick]
```

### Wave 2: Infrastructure (8 tasks)

```
Wave 2 (After Wave 1 - core infrastructure):
├── T6: Implement per-provider circuit breaker [deep]
├── T7: Implement concurrency limiter (semaphore per provider) [deep]
├── T8: Implement error normalization utilities [unspecified-high]
├── T9: Add multimodal endpoint constants [quick]
├── T10: Extend health check probes for multimodal endpoints [unspecified-high]
├── T11: Extend health check scheduler to detect multimodal capabilities [unspecified-high]
├── T12: Request transformation utilities (OpenAI → MiniMax) [unspecified-high]
└── T13: Response transformation utilities (MiniMax → OpenAI) [unspecified-high]
```

### Wave 3: TTS Implementation (6 tasks)

```
Wave 3 (After Wave 2 - TTS handlers):
├── T14: Add TTS models to provider-defaults [quick]
├── T15: Implement MiniMax TTS adapter [unspecified-high]
├── T16: Implement OpenAI TTS adapter [unspecified-high]
├── T17: Add POST /v1/audio/speech handler [unspecified-high]
├── T18: Add GET /v1/tasks/:taskId polling endpoint [unspecified-high]
├── T19: Add DELETE /v1/tasks/:taskId cancel endpoint [quick]
└── T20: Add TTS to /v1/models response [quick]
```

### Wave 4: Image Generation Implementation (6 tasks)

```
Wave 4 (After Wave 3 - Image handlers):
├── T21: Add image models to provider-defaults [quick]
├── T22: Implement MiniMax image adapter [unspecified-high]
├── T23: Implement OpenAI image adapter [unspecified-high]
├── T24: Add POST /v1/images/generations handler [unspecified-high]
├── T25: Add POST /v1/images/edits handler [unspecified-high]
├── T26: Add POST /v1/images/variations handler [quick]
└── T27: Add image models to /v1/models response [quick]
```

### Wave 5: Video Generation Implementation (6 tasks)

```
Wave 5 (After Wave 4 - Video handlers):
├── T28: Add video models to provider-defaults [quick]
├── T29: Implement MiniMax video adapter (submit + poll) [deep]
├── T30: Add POST /v1/video/generations handler [unspecified-high]
├── T31: Add GET /v1/tasks/:taskId polling endpoint [unspecified-high]
├── T32: Add DELETE /v1/tasks/:taskId cancel endpoint [quick]
└── T33: Add video models to /v1/models response [quick]
```

### Wave 6: Integration & Frontend (8 tasks)

```
Wave 6 (After Wave 5 - integration + frontend):
├── T34: Update OpenAPI schema for multimodal endpoints [quick]
├── T35: Update servers-controller.ts types [quick]
├── T36: Update frontend AddServer modal with multimodal options [visual-engineering]
├── T37: Update frontend ServerCard with multimodal badges [visual-engineering]
├── T38: Add multimodal capability detection to frontend [visual-engineering]
├── T39: Integration test: TTS end-to-end with mock [unspecified-high]
├── T40: Integration test: Images end-to-end with mock [unspecified-high]
└── T41: Integration test: Video end-to-end with mock [unspecified-high]
```

### Dependency Matrix

```
T1 (types): - - T2,T3,T4,T5
T2 (schema): T1 - T6,T7,T8,T12,T13
T3 (async-task): T1 - T4,T6,T7
T4 (task-store): T1,T3 - T6,T7
T5 (backoff): - - T6,T7,T10,T11

T6 (circuit-breaker): T2 - T14,T15,T16
T7 (concurrency): T2,T4 - T14,T15,T16
T8 (error-norm): T2 - T15,T16,T22,T23,T29
T9 (constants): T2 - T10,T11
T10 (health-probes): T5,T9 - T11
T11 (health-scheduler): T5,T9,T10 - T14,T15,T16
T12 (req-transform): T2 - T15,T16,T22,T23,T29
T13 (resp-transform): T2 - T15,T16,T22,T23,T29

T14 (tts-defaults): T6,T7,T11 - T17
T15 (minimax-tts): T6,T7,T8,T12,T13 - T17,T18
T16 (openai-tts): T6,T7,T8,T12,T13 - T17,T18
T17 (audio-handler): T14,T15,T16 - T19,T20
T18 (task-poll): T15,T16 - T19
T19 (task-cancel): T18 - 
T20 (tts-models): T17 - T39

T21 (img-defaults): T6,T7,T11 - T24
T22 (minimax-img): T6,T7,T8,T12,T13 - T24,T25
T23 (openai-img): T6,T7,T8,T12,T13 - T24,T25
T24 (images-handler): T21,T22,T23 - T25,T26,T27
T25 (images-edits): T24 - T27
T26 (images-variations): T24 - T27
T27 (img-models): T24 - T40

T28 (video-defaults): T6,T7,T11 - T30
T29 (minimax-video): T6,T7,T8,T12,T13 - T30,T31
T30 (video-handler): T28,T29 - T31,T32,T33
T31 (video-poll): T29,T30 - T32
T32 (video-cancel): T31 - T33
T33 (video-models): T30 - T41

T34 (openapi): T20,T27,T33 - T35
T35 (controller-types): T34 - T36,T37
T36 (frontend-modal): T35 - T38
T37 (frontend-cards): T35 - T38
T38 (frontend-caps): T36,T37 - T39,T40,T41
T39 (int-test-tts): T20,T38 - F1
T40 (int-test-img): T27,T38 - F1
T41 (int-test-video): T33,T38 - F1
```

### Agent Dispatch Summary

- **Wave 1**: 5 tasks - T1,T2,T3,T4,T5 → `quick` (5 parallel)
- **Wave 2**: 8 tasks - T6,T7 → `deep`, T8,T10,T11,T12,T13 → `unspecified-high`, T9 → `quick`
- **Wave 3**: 6 tasks - T14,T19,T20 → `quick`, T15,T16,T17,T18 → `unspecified-high`
- **Wave 4**: 7 tasks - T21,T26,T27 → `quick`, T22,T23,T24,T25 → `unspecified-high`
- **Wave 5**: 6 tasks - T28,T32,T33 → `quick`, T29,T30,T31 → `deep`/`unspecified-high`
- **Wave 6**: 8 tasks - T34,T35 → `quick`, T36,T37,T38,T39,T40,T41 → `visual-engineering`/`unspecified-high`
- **FINAL**: 4 tasks - F1 → `oracle`, F2,F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] T1. Extend AIServer type with multimodal capability flags

  **What to do**:
  - Edit `src/orchestrator/orchestrator.types.ts` to add to `AIServer` interface:
    ```typescript
    // Multimodal capabilities
    supportsImages?: boolean;   // Server can handle /v1/images/*
    supportsAudio?: boolean;     // Server can handle /v1/audio/*
    supportsVideo?: boolean;    // Server can handle /v1/video/*
    ```
  - These flags complement existing `supportsV1`, `supportsOllama`, `supportsAnthropic`
  - Default to `undefined` (auto-detect via health check)

  **Must NOT do**:
  - Do NOT remove existing capability flags
  - Do NOT add implementation logic here (just types)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Type definition only, straightforward addition
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T2, T3, T4, T5)
  - **Blocks**: T2, T6, T7
  - **Blocked By**: None (can start immediately)

  **References**:
  - `src/orchestrator/orchestrator.types.ts:25-79` - AIServer interface with existing capability flags
  - `src/health-check-scheduler.ts:370-373` - How supportsAnthropic is inferred from probes

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] `AIServer.supportsImages` is optional boolean
  - [ ] `AISServer.supportsAudio` is optional boolean
  - [ ] `AISServer.supportsVideo` is optional boolean

  **QA Scenarios**:

  ```
  Scenario: Type definition compiles
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run build
    Expected Result: No TypeScript errors
    Evidence: .sisyphus/evidence/task-1-types-compile.log
  ```

- [ ] T2. Extend endpointOverrides schema for multimodal paths

  **What to do**:
  - Edit `src/orchestrator/orchestrator.types.ts` to extend `endpointOverrides`:
    ```typescript
    endpointOverrides?: {
      // Existing (for MiniMax Anthropic):
      anthropic_messages?: string;
      anthropic_auth?: { headerName: string; headerPrefix: string };
      
      // NEW - multimodal paths:
      images_generation?: string;   // Default: "/v1/images/generations"
      audio_speech?: string;         // Default: "/v1/audio/speech"
      video_generation?: string;     // Default: "/v1/video/generations"
      task_query?: string;          // Provider-specific task status endpoint
    };
    ```
  - Also update `src/config/schema.ts` if validation is needed

  **Must NOT do**:
  - Do NOT change existing anthropic_* fields
  - Do NOT add validation that would reject existing configs

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Schema extension, straightforward
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T3, T4, T5)
  - **Blocks**: T6, T7, T12, T13
  - **Blocked By**: T1 (depends on type definitions)

  **References**:
  - `src/orchestrator/orchestrator.types.ts:49-59` - Current endpointOverrides definition
  - `src/config/schema.ts:84-100` - updateServerConfigSchema for reference

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] endpointOverrides.images_generation is optional string
  - [ ] endpointOverrides.audio_speech is optional string
  - [ ] endpointOverrides.video_generation is optional string
  - [ ] endpointOverrides.task_query is optional string

  **QA Scenarios**:

  ```
  Scenario: Schema extension compiles
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run build
    Expected Result: No TypeScript errors
    Evidence: .sisyphus/evidence/task-2-schema-compile.log
  ```

- [ ] T3. Define AsyncTask interface and states

  **What to do**:
  - Create `src/types/async-task.types.ts`:
    ```typescript
    export type AsyncTaskStatus = 
      | 'PENDING'      // Task submitted, not started
      | 'IN_PROGRESS'  // Provider is working
      | 'COMPLETED'    // Success, result available
      | 'FAILED'       // Error, check error field
      | 'CANCELLED';   // User cancelled

    export interface AsyncTask {
      id: string;                    // UUID or provider task ID
      provider: string;              // 'minimax' | 'openai'
      serverId: string;              // AIServer.id that handled this
      model: string;                // Model used
      modality: 'tts' | 'image' | 'video';
      status: AsyncTaskStatus;
      createdAt: Date;
      updatedAt: Date;
      completedAt?: Date;
      expiresAt?: Date;              // When result URL expires
      result?: {
        // For TTS
        audioData?: string;          // hex or base64
        audioFormat?: string;        // mp3, wav, etc.
        // For Images
        imageUrls?: string[];
        // For Video
        videoUrl?: string;
      };
      error?: {
        code: string;                // Normalized error code
        message: string;             // User-friendly message
        providerCode?: string;       // Original provider error code
      };
      metadata?: Record<string, unknown>;  // Provider-specific data
    }

    export interface CreateAsyncTaskRequest {
      model: string;
      modality: 'tts' | 'image' | 'video';
      provider: string;
      serverId: string;
      expiresAt?: Date;
      metadata?: Record<string, unknown>;
    }
    ```

  **Must NOT do**:
  - Do NOT implement storage here (T4 does that)
  - Do NOT add business logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Type definitions only
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T4, T5)
  - **Blocks**: T4, T6, T7
  - **Blocked By**: T1 (depends on type definitions)

  **References**:
  - `src/orchestrator/orchestrator.types.ts` - Existing type patterns
  - `src/types/api-request.types.ts` - Request type patterns

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] AsyncTaskStatus is union of 5 states
  - [ ] AsyncTask has all required fields
  - [ ] CreateAsyncTaskRequest interface exists

  **QA Scenarios**:

  ```
  Scenario: AsyncTask types compile correctly
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run build
    Expected Result: No TypeScript errors
    Evidence: .sisyphus/evidence/task-3-types-compile.log
  ```

- [ ] T4. Implement AsyncTaskStore in-memory

  **What to do**:
  - Create `src/utils/async-task-store.ts`:
    ```typescript
    import { AsyncTask, AsyncTaskStatus, CreateAsyncTaskRequest } from '../types/async-task.types';
    
    export class AsyncTaskStore {
      private tasks: Map<string, AsyncTask> = new Map();
      
      create(req: CreateAsyncTaskRequest): AsyncTask {
        const task: AsyncTask = {
          id: crypto.randomUUID(),
          provider: req.provider,
          serverId: req.serverId,
          model: req.model,
          modality: req.modality,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: req.expiresAt,
          metadata: req.metadata,
        };
        this.tasks.set(task.id, task);
        return task;
      }
      
      get(id: string): AsyncTask | undefined {
        return this.tasks.get(id);
      }
      
      update(id: string, updates: Partial<AsyncTask>): AsyncTask | undefined {
        const task = this.tasks.get(id);
        if (!task) return undefined;
        const updated = { ...task, ...updates, updatedAt: new Date() };
        this.tasks.set(id, updated);
        return updated;
      }
      
      updateStatus(id: string, status: AsyncTaskStatus, updates?: Partial<AsyncTask>): AsyncTask | undefined {
        return this.update(id, { status, ...updates });
      }
      
      listByServer(serverId: string): AsyncTask[] {
        return Array.from(this.tasks.values()).filter(t => t.serverId === serverId);
      }
      
      listByStatus(status: AsyncTaskStatus): AsyncTask[] {
        return Array.from(this.tasks.values()).filter(t => t.status === status);
      }
      
      delete(id: string): boolean {
        return this.tasks.delete(id);
      }
      
      // Cleanup expired tasks (call periodically)
      cleanupExpired(): number {
        const now = new Date();
        let count = 0;
        for (const [id, task] of this.tasks) {
          if (task.expiresAt && task.expiresAt < now) {
            this.tasks.delete(id);
            count++;
          }
        }
        return count;
      }
    }
    
    // Singleton instance
    export const asyncTaskStore = new AsyncTaskStore();
    ```

  **Must NOT do**:
  - Do NOT add persistence (in-memory only for v1)
  - Do NOT add distributed locking

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Standard CRUD store pattern
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T5)
  - **Blocks**: T6, T7, T15, T16, T22, T23, T29 (all async task operations)
  - **Blocked By**: T3 (depends on AsyncTask types)

  **References**:
  - `src/config/json-file-handler.ts` - Existing store patterns
  - `src/circuit-breaker/circuit-breaker.ts` - Existing singleton pattern

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] AsyncTaskStore has create, get, update, updateStatus, listByServer, listByStatus, delete methods
  - [ ] Singleton instance exported
  - [ ] Unit tests pass

  **QA Scenarios**:

  ```
  Scenario: AsyncTaskStore CRUD operations
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run test -- tests/unit/async-task-store.test.ts
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-4-store-crud.log

  Scenario: Task status transitions work correctly
    Tool: Bash
    Steps:
      1. Create task with PENDING status
      2. Update to IN_PROGRESS
      3. Update to COMPLETED with result
      4. Verify all transitions work
    Expected Result: Status transitions work, timestamps updated
    Evidence: .sisyphus/evidence/task-4-status-transitions.log
  ```

- [ ] T5. Implement exponential backoff utility with jitter

  **What to do**:
  - Create `src/utils/backoff.ts`:
    ```typescript
    export interface BackoffOptions {
      initialIntervalMs: number;   // Starting interval (e.g., 500)
      maxIntervalMs: number;      // Cap (e.g., 30000)
      maxAttempts?: number;        // Optional max attempts
      backoffFactor?: number;      // Multiplier (e.g., 1.5)
      jitterFactor?: number;        // Randomness factor (e.g., 0.1 = 10%)
    }

    export const DEFAULT_BACKOFF_OPTIONS: Required<BackoffOptions> = {
      initialIntervalMs: 500,
      maxIntervalMs: 30000,
      maxAttempts: Infinity,
      backoffFactor: 1.5,
      jitterFactor: 0.1,
    };

    export function calculateBackoff(attempt: number, options: BackoffOptions = {}): number {
      const opts = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
      
      if (attempt <= 0) return opts.initialIntervalMs;
      if (attempt > opts.maxAttempts) return -1; // Indicates max attempts exceeded
      
      // Calculate base interval
      const baseInterval = opts.initialIntervalMs * Math.pow(opts.backoffFactor, attempt - 1);
      
      // Cap at max
      const cappedInterval = Math.min(baseInterval, opts.maxIntervalMs);
      
      // Add jitter to prevent thundering herd
      const jitterRange = cappedInterval * opts.jitterFactor;
      const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitter to +jitter
      
      return Math.round(cappedInterval + jitter);
    }

    export class BackoffTimer {
      private attempt: number = 0;
      private options: Required<BackoffOptions>;
      
      constructor(options: BackoffOptions = {}) {
        this.options = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
      }
      
      getNextInterval(): number {
        const interval = calculateBackoff(this.attempt, this.options);
        this.attempt++;
        return interval;
      }
      
      reset(): void {
        this.attempt = 0;
      }
      
      getAttempt(): number {
        return this.attempt;
      }
      
      shouldStop(): boolean {
        return this.attempt >= this.options.maxAttempts;
      }
    }

    // Utility for polling with backoff
    export async function pollWithBackoff<T>(
      fn: () => Promise<T>,
      checkComplete: (result: T) => boolean,
      options: BackoffOptions = {}
    ): Promise<{ result: T; attempts: number; timedOut: boolean }> {
      const timer = new BackoffTimer(options);
      let attempts = 0;
      
      while (true) {
        const result = await fn();
        attempts++;
        
        if (checkComplete(result)) {
          return { result, attempts, timedOut: false };
        }
        
        if (timer.shouldStop()) {
          return { result, attempts, timedOut: true };
        }
        
        const interval = timer.getNextInterval();
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }
    ```

  **Must NOT do**:
  - Do NOT implement polling logic (just backoff calculation)
  - Do NOT add network requests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Pure utility function, no external dependencies
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with T1, T2, T3, T4)
  - **Blocks**: T6, T7, T10, T11, T15, T16, T22, T23, T29 (all polling operations)
  - **Blocked By**: None

  **References**:
  - Research findings: Exponential backoff with jitter is mandatory to prevent thundering herd
  - Recommended intervals: Image 500ms initial, Video 2000ms initial, 1.5x factor

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] calculateBackoff returns increasing intervals
  - [ ] Jitter is applied (interval varies between calls)
  - [ ] maxIntervalMs is respected
  - [ ] maxAttempts returns -1 when exceeded
  - [ ] BackoffTimer.reset() works
  - [ ] pollWithBackoff utility works

  **QA Scenarios**:

  ```
  Scenario: Backoff intervals increase exponentially
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run test -- tests/unit/backoff.test.ts
    Expected Result: Intervals increase: 500, 750, 1125, 1687...
    Evidence: .sisyphus/evidence/task-5-exponential.log

  Scenario: Jitter prevents synchronized retries
    Tool: Bash
    Steps:
      1. Call calculateBackoff(1, {initialIntervalMs: 1000, jitterFactor: 0.1}) 10 times
      2. Check that intervals are NOT all identical
    Expected Result: Intervals vary by ~10% (900-1100ms range)
    Evidence: .sisyphus/evidence/task-5-jitter.log

  Scenario: Max interval is respected
    Tool: Bash
    Steps:
      1. Calculate backoff for high attempt number
      2. Verify result <= maxIntervalMs
    Expected Result: Intervals cap at maxIntervalMs
    Evidence: .sisyphus/evidence/task-5-max-cap.log
  ```

- [ ] T6. Implement per-provider circuit breaker

  **What to do**:
  - Create `src/utils/circuit-breaker-multimodal.ts`:
    ```typescript
    import { EventEmitter } from 'events';
    
    export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
    
    export interface CircuitBreakerConfig {
      name: string;                      // Provider name, e.g., 'minimax', 'openai'
      failureThreshold: number;          // % failures to open (e.g., 50)
      recoveryTimeoutMs: number;         // Time before trying again (e.g., 30000)
      monitorIntervalMs: number;         // How often to check (e.g., 10000)
      halfOpenSuccessThreshold: number;   // Successes needed to close (e.g., 3)
    }
    
    export interface CircuitBreakerMetrics {
      totalRequests: number;
      failedRequests: number;
      successRequests: number;
      lastFailure: Date | null;
      state: CircuitBreakerState;
    }
    
    export class MultimodalCircuitBreaker extends EventEmitter {
      private state: CircuitBreakerState = 'CLOSED';
      private failureCount: number = 0;
      private successCount: number = 0;
      private lastFailureTime: number = 0;
      private config: Required<CircuitBreakerConfig>;
      private requestCount: number = 0;
      private failureCountTotal: number = 0;
      private successCountTotal: number = 0;
      
      constructor(config: CircuitBreakerConfig) {
        super();
        this.config = {
          failureThreshold: config.failureThreshold,
          recoveryTimeoutMs: config.recoveryTimeoutMs,
          monitorIntervalMs: config.monitorIntervalMs,
          halfOpenSuccessThreshold: config.halfOpenSuccessThreshold,
          name: config.name,
        };
      }
      
      getState(): CircuitBreakerState {
        if (this.state === 'OPEN') {
          // Check if recovery timeout has passed
          if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeoutMs) {
            this.state = 'HALF_OPEN';
            this.emit('stateChange', 'HALF_OPEN');
          }
        }
        return this.state;
      }
      
      async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.getState() === 'OPEN') {
          throw new Error(`Circuit breaker OPEN for ${this.config.name}. Provider unavailable.`);
        }
        
        try {
          this.requestCount++;
          const result = await fn();
          this.onSuccess();
          return result;
        } catch (error) {
          this.onFailure();
          throw error;
        }
      }
      
      private onSuccess(): void {
        this.successCount++;
        this.successCountTotal++;
        
        if (this.state === 'HALF_OPEN') {
          if (this.successCount >= this.config.halfOpenSuccessThreshold) {
            this.state = 'CLOSED';
            this.failureCount = 0;
            this.successCount = 0;
            this.emit('stateChange', 'CLOSED');
          }
        } else {
          this.failureCount = 0;
        }
      }
      
      private onFailure(): void {
        this.failureCount++;
        this.failureCountTotal++;
        this.lastFailureTime = Date.now();
        
        if (this.state === 'HALF_OPEN') {
          // Failed during recovery attempt - go back to OPEN
          this.state = 'OPEN';
          this.emit('stateChange', 'OPEN');
        } else {
          // Check if we've hit the failure threshold
          const totalAttempts = this.successCountTotal + this.failureCountTotal;
          if (totalAttempts >= 10) { // Need minimum sample size
            const failureRate = this.failureCountTotal / totalAttempts;
            if (failureRate >= this.config.failureThreshold / 100) {
              this.state = 'OPEN';
              this.emit('stateChange', 'OPEN');
            }
          }
        }
      }
      
      getMetrics(): CircuitBreakerMetrics {
        return {
          totalRequests: this.requestCount,
          failedRequests: this.failureCountTotal,
          successRequests: this.successCountTotal,
          lastFailure: this.lastFailureTime ? new Date(this.lastFailureTime) : null,
          state: this.getState(),
        };
      }
      
      reset(): void {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.successCount = 0;
        this.requestCount = 0;
        this.failureCountTotal = 0;
        this.successCountTotal = 0;
      }
    }
    
    // Registry for per-provider circuit breakers
    export class CircuitBreakerRegistry {
      private breakers: Map<string, MultimodalCircuitBreaker> = new Map();
      
      getOrCreate(name: string, config?: Partial<CircuitBreakerConfig>): MultimodalCircuitBreaker {
        if (!this.breakers.has(name)) {
          this.breakers.set(name, new MultimodalCircuitBreaker({
            name,
            failureThreshold: config?.failureThreshold ?? 50,
            recoveryTimeoutMs: config?.recoveryTimeoutMs ?? 30000,
            monitorIntervalMs: config?.monitorIntervalMs ?? 10000,
            halfOpenSuccessThreshold: config?.halfOpenSuccessThreshold ?? 3,
          }));
        }
        return this.breakers.get(name)!;
      }
      
      get(name: string): MultimodalCircuitBreaker | undefined {
        return this.breakers.get(name);
      }
      
      list(): Map<string, MultimodalCircuitBreaker> {
        return new Map(this.breakers);
      }
    }
    
    export const circuitBreakerRegistry = new CircuitBreakerRegistry();
    ```

  **Must NOT do**:
  - Do NOT use a single global circuit breaker (per-provider only)
  - Do NOT retry automatically in execute() - caller handles retries
  - Do NOT add persistence

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Reason**: Complex state machine logic
  - **Skills**: None required but understanding of circuit breaker pattern needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T7, T8, T9, T10, T11, T12, T13)
  - **Blocks**: T14, T15, T16, T22, T23, T29
  - **Blocked By**: T2, T4

  **References**:
  - `src/circuit-breaker/circuit-breaker.ts` - Existing circuit breaker patterns
  - Research: Per-provider isolation is mandatory, 3-state machine (Closed → Open → Half-Open)

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] CLOSED → OPEN transitions when failure threshold exceeded
  - [ ] OPEN → HALF_OPEN after recovery timeout
  - [ ] HALF_OPEN → CLOSED after success threshold
  - [ ] HALF_OPEN → OPEN on failure
  - [ ] execute() throws when OPEN
  - [ ] Metrics track failures and successes

  **QA Scenarios**:

  ```
  Scenario: Circuit opens after 50% failure rate
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run test -- tests/unit/circuit-breaker.test.ts
    Expected Result: Circuit opens, subsequent calls throw
    Evidence: .sisyphus/evidence/task-6-circuit-open.log

  Scenario: Circuit recovers after timeout
    Tool: Bash
    Steps:
      1. Set recoveryTimeoutMs to 100ms
      2. Trigger OPEN state
      3. Wait 100ms
      4. Call execute() - should go to HALF_OPEN
    Expected Result: State transitions to HALF_OPEN
    Evidence: .sisyphus/evidence/task-6-circuit-recover.log
  ```

- [ ] T7. Implement concurrency limiter (semaphore per provider)

  **What to do**:
  - Create `src/utils/concurrency-limiter.ts`:
    ```typescript
    export interface ConcurrencyLimiterConfig {
      name: string;                    // Provider name
      maxConcurrent: number;          // Max concurrent requests per provider
    }

  export interface QueuedRequest<T> {
    fn: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    enqueuedAt: Date;
  }

  export class ProviderConcurrencyLimiter {
    private name: string;
    private maxConcurrent: number;
    private running: number = 0;
    private queue: QueuedRequest<any>[] = [];
    
    constructor(config: ConcurrencyLimiterConfig) {
      this.name = config.name;
      this.maxConcurrent = config.maxConcurrent;
    }
    
    getAvailableCapacity(): number {
      return Math.max(0, this.maxConcurrent - this.running);
    }
    
    getQueueLength(): number {
      return this.queue.length;
    }
    
    async execute<T>(fn: () => Promise<T>): Promise<T> {
      if (this.running < this.maxConcurrent) {
        this.running++;
        try {
          return await fn();
        } finally {
          this.running--;
          this.dequeue();
        }
      } else {
        // Queue the request
        return new Promise((resolve, reject) => {
          this.queue.push({
            fn,
            resolve,
            reject,
            enqueuedAt: new Date(),
          });
        });
      }
    }
    
    private dequeue(): void {
      if (this.queue.length > 0 && this.running < this.maxConcurrent) {
        this.running++;
        const request = this.queue.shift()!;
        
        request.fn()
          .then(request.resolve)
          .catch(request.reject)
          .finally(() => {
            this.running--;
            this.dequeue(); // Process next in queue
          });
      }
    }
    
    // Emergency drain - rejects all queued requests
    drain(reason: Error): void {
      for (const request of this.queue) {
        request.reject(reason);
      }
      this.queue = [];
    }
    
    getMetrics() {
      return {
        name: this.name,
        maxConcurrent: this.maxConcurrent,
        running: this.running,
        queued: this.queue.length,
        availableCapacity: this.getAvailableCapacity(),
      };
    }
  }

  export class ConcurrencyLimiterRegistry {
    private limiters: Map<string, ProviderConcurrencyLimiter> = new Map();
    
    getOrCreate(name: string, maxConcurrent: number = 10): ProviderConcurrencyLimiter {
      if (!this.limiters.has(name)) {
        this.limiters.set(name, new ProviderConcurrencyLimiter({ name, maxConcurrent }));
      }
      return this.limiters.get(name)!;
    }
    
    get(name: string): ProviderConcurrencyLimiter | undefined {
      return this.limiters.get(name);
    }
    
    list(): Map<string, ProviderConcurrencyLimiter> {
      return new Map(this.limiters);
    }
  }
  
  export const concurrencyLimiterRegistry = new ConcurrencyLimiterRegistry();
  ```

  **Must NOT do**:
  - Do NOT mix providers - each provider gets its own semaphore
  - Do NOT add rate limiting (RPM/TPM) - just concurrency control

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Reason**: Concurrency control logic with queue management
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T8, T9, T10, T11, T12, T13)
  - **Blocks**: T14, T15, T16, T22, T23, T29
  - **Blocked By**: T2, T4

  **References**:
  - Research: Two-tier approach (Semaphore + Token Bucket). This is Semaphore tier.
  - `src/orchestrator/orchestrator.ts` - How maxConcurrency is used per server

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] Concurrent requests limited to maxConcurrent
  - [ ] Queued requests processed FIFO
  - [ ] drain() rejects all queued requests
  - [ ] Metrics show correct running/queued counts

  **QA Scenarios**:

  ```
  Scenario: Concurrency limit enforced
    Tool: Bash
    Steps:
      1. Set maxConcurrent to 2
      2. Execute 5 async operations (each takes 100ms)
      3. Measure total time - should be ~300ms (2 batches)
    Expected Result: Only 2 run concurrently
    Evidence: .sisyphus/evidence/task-7-concurrency-limit.log

  Scenario: Queue drains FIFO
    Tool: Bash
    Steps:
      1. Queue 3 requests
      2. Complete first batch
      3. Verify order of execution matches queue order
    Expected Result: FIFO processing
    Evidence: .sisyphus/evidence/task-7-fifo.log
  ```

- [ ] T8. Implement error normalization utilities

  **What to do**:
  - Create `src/utils/error-normalizer.ts`:
    ```typescript
    export interface NormalizedError {
      code: string;           // Standard code: RATE_LIMIT, TIMEOUT, AUTH_FAILED, etc.
      message: string;        // User-friendly message
      retryable: boolean;      // Should client retry?
      providerCode?: string;   // Original provider error code
      providerMessage?: string; // Original provider message
      statusCode?: number;     // HTTP status code
    }

    // Standard error codes
    export const ErrorCodes = {
      // Retryable
      RATE_LIMIT: 'RATE_LIMIT',
      TIMEOUT: 'TIMEOUT',
      SERVER_ERROR: 'SERVER_ERROR',      // 5xx
      NETWORK_ERROR: 'NETWORK_ERROR',
      SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
      
      // Non-retryable (client errors)
      AUTH_FAILED: 'AUTH_FAILED',         // 401
      FORBIDDEN: 'FORBIDDEN',             // 403
      NOT_FOUND: 'NOT_FOUND',             // 404
      INVALID_REQUEST: 'INVALID_REQUEST', // 400
      CONTENT_FILTERED: 'CONTENT_FILTERED', // 422 or similar
      QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',   // Billing
      
      // Provider-specific
      PROVIDER_ERROR: 'PROVIDER_ERROR',
    } as const;

    export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

    export function normalizeError(error: any, provider: string): NormalizedError {
      // Handle network errors
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        return {
          code: ErrorCodes.NETWORK_ERROR,
          message: `Network error connecting to ${provider}`,
          retryable: true,
          providerCode: error.code,
        };
      }
      
      // Handle fetch response errors
      const status = error.status || error.statusCode;
      const providerCode = error.code || error.error?.code;
      const providerMessage = error.message || error.error?.message || error.status_msg;
      
      if (status) {
        switch (Math.floor(status / 100)) {
          case 4:
            // Client errors - generally not retryable
            if (status === 401 || status === 403) {
              return {
                code: status === 401 ? ErrorCodes.AUTH_FAILED : ErrorCodes.FORBIDDEN,
                message: `Authentication failed for ${provider}`,
                retryable: false,
                statusCode: status,
                providerCode: String(providerCode),
                providerMessage: String(providerMessage),
              };
            }
            if (status === 429) {
              return {
                code: ErrorCodes.RATE_LIMIT,
                message: `Rate limit exceeded for ${provider}`,
                retryable: true,
                statusCode: status,
                providerCode: String(providerCode),
                providerMessage: String(providerMessage),
              };
            }
            return {
              code: ErrorCodes.INVALID_REQUEST,
              message: String(providerMessage) || `Invalid request to ${provider}`,
              retryable: false,
              statusCode: status,
              providerCode: String(providerCode),
              providerMessage: String(providerMessage),
            };
            
          case 5:
            // Server errors - retryable
            return {
              code: ErrorCodes.SERVER_ERROR,
              message: `${provider} server error: ${providerMessage}`,
              retryable: true,
              statusCode: status,
              providerCode: String(providerCode),
              providerMessage: String(providerMessage),
            };
        }
      }
      
      // Timeout
      if (error.type === 'timeout' || error.message?.includes('timeout')) {
        return {
          code: ErrorCodes.TIMEOUT,
          message: `Request to ${provider} timed out`,
          retryable: true,
          providerCode: String(providerCode),
        };
      }
      
      // Default - wrap as provider error
      return {
        code: ErrorCodes.PROVIDER_ERROR,
        message: `${provider} error: ${String(providerMessage || error)}`,
        retryable: false,
        providerCode: String(providerCode),
        providerMessage: String(providerMessage),
      };
    }

    export function isRetryable(error: NormalizedError): boolean {
      return error.retryable;
    }
    ```

  **Must NOT do**:
  - Do NOT return raw provider error messages to clients (security risk)
  - Do NOT retry 4xx client errors (except 429)
  - Do NOT retry indefinitely

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Error handling patterns, needs careful thought
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T9, T10, T11, T12, T13)
  - **Blocks**: T15, T16, T22, T23, T29
  - **Blocked By**: T2

  **References**:
  - Research: "Never return raw provider error messages directly to clients"
  - Existing error handling in `src/middleware/error-handler.ts`

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] 401/403 → AUTH_FAILED/FORBIDDEN (non-retryable)
  - [ ] 429 → RATE_LIMIT (retryable)
  - [ ] 5xx → SERVER_ERROR (retryable)
  - [ ] Network errors → NETWORK_ERROR (retryable)
  - [ ] isRetryable() correctly identifies retryable errors

  **QA Scenarios**:

  ```
  Scenario: Error normalization for different providers
    Tool: Bash
    Steps:
      1. cd /root/ollama-orchestrator && npm run test -- tests/unit/error-normalizer.test.ts
    Expected Result: Errors correctly classified
    Evidence: .sisyphus/evidence/task-8-errors.log
  ```

- [ ] T9. Add multimodal endpoint constants

  **What to do**:
  - Edit `src/constants/api-endpoints.ts` to add:
    ```typescript
    // Multimodal endpoints
    export const API_ENDPOINTS = {
      // ... existing endpoints ...
      
      // Image generation
      IMAGES_GENERATIONS: '/v1/images/generations',
      IMAGES_EDITS: '/v1/images/edits',
      IMAGES_VARIATIONS: '/v1/images/variations',
      
      // Audio / TTS
      AUDIO_SPEECH: '/v1/audio/speech',
      AUDIO_TRANSCRIPTIONS: '/v1/audio/transcriptions',
      
      // Video generation
      VIDEO_GENERATIONS: '/v1/video/generations',
      
      // Async task management
      TASKS: '/v1/tasks',
    } as const;
    ```

  **Must NOT do**:
  - Do NOT change existing endpoint constants
  - Do NOT add business logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple constant addition
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8, T10, T11, T12, T13)
  - **Blocks**: T10, T11
  - **Blocked By**: T2

  **References**:
  - `src/constants/api-endpoints.ts` - Existing constants

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] All new constants defined

- [ ] T10. Extend health check probes for multimodal endpoints

  **What to do**:
  - Edit `src/health-check-scheduler.ts` to add probe for:
    - `/v1/images/generations` or custom path
    - `/v1/audio/speech` or custom path
    - `/v1/video/generations` or custom path
  - Add to `probedEndpoints` type:
    ```typescript
    probedEndpoints?: {
      // ... existing ...
      images_generations?: boolean;
      audio_speech?: boolean;
      video_generations?: boolean;
    };
    ```
  - Add new probe methods similar to existing `probeInferenceEndpoint`

  **Must NOT do**:
  - Do NOT change existing probe logic (keep `/v1/models` for v1 detection)
  - Do NOT mark server unhealthy based on these probes alone

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Health check logic, careful about side effects
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8, T9, T11, T12, T13)
  - **Blocks**: T11
  - **Blocked By**: T5, T9

  **References**:
  - `src/health-check-scheduler.ts:580-654` - runEndpointProbes implementation
  - Research: Polling intervals - Image 500ms, Video 2000ms

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] New probes added to runEndpointProbes
  - [ ] Probes use exists=true/false like existing probes

  **QA Scenarios**:

  ```
  Scenario: Health check probes detect multimodal endpoints
    Tool: Bash
    Steps:
      1. Configure MiniMax server with endpointOverrides
      2. Trigger health check
      3. Verify probedEndpoints includes new fields
    Expected Result: probedEndpoints shows multimodal support
    Evidence: .sisyphus/evidence/task-10-probes.log
  ```

- [ ] T11. Extend health check scheduler to detect multimodal capabilities

  **What to do**:
  - Edit `src/health-check-scheduler.ts` to update `supportsImages`, `supportsAudio`, `supportsVideo` based on probe results and `endpointOverrides`:
    ```typescript
    // Around line 370-380, after supportsAnthropic
    const inferredImages = probedEndpoints.images_generations || 
      !!overrides?.images_generations;  // If override set, assume supported
    const inferredAudio = probedEndpoints.audio_speech || 
      !!overrides?.audio_speech;
    const inferredVideo = probedEndpoints.video_generations || 
      !!overrides?.video_generations;
    
    const supportsImages = forced.supportsImages ?? inferredImages;
    const supportsAudio = forced.supportsAudio ?? inferredAudio;
    const supportsVideo = forced.supportsVideo ?? inferredVideo;
    ```

  **Must NOT do**:
  - Do NOT override forcedCapabilities - respect admin overrides
  - Do NOT mark server unhealthy if these probes fail (only infer capability)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Health check state management
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8, T9, T10, T12, T13)
  - **Blocks**: T14, T15, T16, T22, T23, T29
  - **Blocked By**: T5, T9, T10

  **References**:
  - `src/health-check-scheduler.ts:370-393` - How supportsAnthropic is inferred
  - `src/orchestrator/orchestrator.ts:649-695` - updateServer method

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] Server.capabilities shows supportsImages/supportsAudio/supportsVideo
  - [ ] forcedCapabilities takes precedence over inference

- [ ] T12. Request transformation utilities (OpenAI → MiniMax)

  **What to do**:
  - Create `src/adapters/transform-request.ts`:
    ```typescript
    import { Request } from 'express';
    
    // Transform OpenAI TTS request to MiniMax format
    export function transformTTSRequestToMiniMax(req: Request): object {
      const { model, input, voice, speed, response_format, ...rest } = req.body;
      
      return {
        model: mapTTSModelToMiniMax(model),
        text: input,
        voice_setting: {
          voice_id: mapVoiceToMiniMax(voice),
          speed: speed || 1,
        },
        output_format: response_format || 'mp3',
        stream: false,
        ...rest,
      };
    }
    
    // Transform OpenAI Images request to MiniMax format  
    export function transformImagesRequestToMiniMax(req: Request): object {
      const { model, prompt, n, size, response_format, ...rest } = req.body;
      
      return {
        model: mapImageModelToMiniMax(model),
        prompt,
        n: n || 1,
        aspect_ratio: mapSizeToAspectRatio(size),
        response_format: response_format === 'base64' ? 'base64' : 'url',
        ...rest,
      };
    }
    
    // Transform OpenAI Video request to MiniMax format
    export function transformVideoRequestToMiniMax(req: Request): object {
      const { model, prompt, ...rest } = req.body;
      
      return {
        model: mapVideoModelToMiniMax(model),
        prompt,
        ...rest,
      };
    }
    
    // Model mapping functions
    function mapTTSModelToMiniMax(model: string): string {
      // tts-1 → speech-02-turbo, etc.
      const mapping: Record<string, string> = {
        'tts-1': 'speech-02-turbo',
        'tts-1-hd': 'speech-02-hd',
        'gpt-4o-mini-tts': 'speech-2.8-turbo',
      };
      return mapping[model] || model;
    }
    
    function mapVoiceToMiniMax(voice: string): string {
      // Map OpenAI voices to MiniMax equivalents
      const mapping: Record<string, string> = {
        'alloy': 'English_Insightful_Speaker',
        'echo': 'English_Persuasive_Man',
        'fable': 'English_Graceful_Lady',
        // ... etc
      };
      return mapping[voice] || voice;
    }
    
    function mapImageModelToMiniMax(model: string): string {
      // dall-e-3, gpt-image-1.5 → image-01
      if (model.includes('dall-e') || model.includes('gpt-image')) {
        return 'image-01';
      }
      return model;
    }
    
    function mapVideoModelToMiniMax(model: string): string {
      // Map to MiniMax video models
      return model; // Pass through for now
    }
    
    function mapSizeToAspectRatio(size: string): string {
      const mapping: Record<string, string> = {
        '1024x1024': '1:1',
        '1792x1024': '16:9',
        '1024x1792': '9:16',
      };
      return mapping[size] || '1:1';
    }
    ```

  **Must NOT do**:
  - Do NOT make assumptions about required fields
  - Do NOT add validation logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Need to research exact field mappings
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8, T9, T10, T11, T13)
  - **Blocks**: T15, T16, T22, T23, T29
  - **Blocked By**: T2

  **References**:
  - MiniMax T2A API docs: model options, voice_setting, output_format
  - OpenAI TTS API docs: model, input, voice options

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] transformTTSRequestToMiniMax correctly maps fields
  - [ ] transformImagesRequestToMiniMax correctly maps fields
  - [ ] Unknown models pass through unchanged

- [ ] T13. Response transformation utilities (MiniMax → OpenAI)

  **What to do**:
  - Create `src/adapters/transform-response.ts`:
    ```typescript
    // Transform MiniMax TTS response to OpenAI format
    export function transformTTSResponseFromMiniMax(response: any): Buffer {
      // MiniMax returns { data: { audio: "hex..." } }
      // We return raw audio buffer
      const hexAudio = response.data?.audio;
      if (!hexAudio) {
        throw new Error('No audio data in MiniMax response');
      }
      return Buffer.from(hexAudio, 'hex');
    }
    
    // Transform MiniMax image response to OpenAI format
    export function transformImagesResponseFromMiniMax(response: any): object {
      // MiniMax returns { data: { image_urls: [...] } }
      // OpenAI returns { created, data: [{ url: ..., b64_json: ... }] }
      const imageUrls = response.data?.image_urls || [];
      return {
        created: Math.floor(Date.now() / 1000),
        data: imageUrls.map((url: string) => ({
          url,
          b64_json: null,
        })),
      };
    }
    
    // Transform MiniMax video response to OpenAI-style format
    export function transformVideoResponseFromMiniMax(response: any): object {
      // MiniMax returns { task_id, status }
      // We return standardized task response
      return {
        task_id: response.task_id,
        status: mapMiniMaxStatusToStandard(response.status),
        created: Math.floor(Date.now() / 1000),
      };
    }
    
    // Transform MiniMax task status to standard status
    function mapMiniMaxStatusToStandard(status: string): string {
      const mapping: Record<string, string> = {
        'PENDING': 'PENDING',
        'RUNNING': 'IN_PROGRESS', 
        'SUCCESS': 'COMPLETED',
        'FAIL': 'FAILED',
      };
      return mapping[status] || status;
    }
    
    // For async tasks, transform full result
    export function transformVideoResultFromMiniMax(response: any): object {
      return {
        status: 'COMPLETED',
        result: {
          video_url: response.data?.video_url || response.file_id,
          // Could include additional metadata
        },
      };
    }
    ```

  **Must NOT do**:
  - Do NOT cache results
  - Do NOT modify original provider response for logging

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Need to research exact response formats
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T6, T7, T8, T9, T10, T11, T12)
  - **Blocks**: T15, T16, T22, T23, T29
  - **Blocked By**: T2

  **References**:
  - MiniMax API docs for response formats
  - OpenAI API docs for expected response formats

  **Acceptance Criteria**:
  - [ ] TypeScript compiles without errors
  - [ ] transformTTSResponseFromMiniMax returns Buffer
  - [ ] transformImagesResponseFromMiniMax returns OpenAI-style response
  - [ ] transformVideoResponseFromMiniMax returns task_id and status

- [ ] T14. Add TTS models to provider-defaults

  **What to do**:
  - Edit `src/config/provider-defaults.ts` to add:
    ```typescript
    // MiniMax TTS models
    MINIMAX_TTS_MODELS: ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo'],
    
    // OpenAI TTS models  
    OPENAI_TTS_MODELS: ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
    ```

  **Must NOT do**:
  - Do NOT add music generation models

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple constant addition
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T15, T16, T17, T18, T19, T20)
  - **Blocks**: T17
  - **Blocked By**: T6, T7, T11

- [ ] T15. Implement MiniMax TTS adapter

  **What to do**:
  - Create `src/adapters/tts/minimax.adapter.ts`:
    ```typescript
    import { Request } from 'express';
    import { transformTTSRequestToMiniMax, transformTTSResponseFromMiniMax } from './transform-request';
    import { circuitBreakerRegistry } from '../../utils/circuit-breaker-multimodal';
    import { concurrencyLimiterRegistry } from '../../utils/concurrency-limiter';
    import { normalizeError } from '../../utils/error-normalizer';
    
    export class MiniMaxTTSAdapter {
      private serverUrl: string;
      private apiKey: string;
      private circuitBreaker = circuitBreakerRegistry.getOrCreate('minimax');
      private limiter = concurrencyLimiterRegistry.getOrCreate('minimax', 5);
      
      constructor(serverUrl: string, apiKey: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
      }
      
      async synthesize(req: Request): Promise<Buffer> {
        const endpoint = `${this.serverUrl}/v1/t2a_v2`;
        
        return this.limiter.execute(async () => {
          return this.circuitBreaker.execute(async () => {
            const miniMaxRequest = transformTTSRequestToMiniMax(req);
            
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(miniMaxRequest),
              signal: AbortSignal.timeout(60000), // 60s timeout for TTS
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw normalizeError({ status: response.status, ...error }, 'minimax');
            }
            
            const data = await response.json();
            return transformTTSResponseFromMiniMax(data);
          });
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT retry within the adapter (caller handles retries)
  - Do NOT cache results

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Adapter pattern, needs to follow existing conventions
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T16, T17, T18, T19, T20)
  - **Blocks**: T17, T18
  - **Blocked By**: T6, T7, T8, T12, T13

- [ ] T16. Implement OpenAI TTS adapter

  **What to do**:
  - Create `src/adapters/tts/openai.adapter.ts`:
    ```typescript
    import { Request } from 'express';
    import { circuitBreakerRegistry } from '../../utils/circuit-breaker-multimodal';
    import { concurrencyLimiterRegistry } from '../../utils/concurrency-limiter';
    import { normalizeError } from '../../utils/error-normalizer';
    
    export class OpenAITTSAdapter {
      private serverUrl: string;
      private apiKey: string;
      private circuitBreaker = circuitBreakerRegistry.getOrCreate('openai');
      private limiter = concurrencyLimiterRegistry.getOrCreate('openai', 10);
      
      constructor(serverUrl: string, apiKey: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
      }
      
      async synthesize(req: Request): Promise<Buffer> {
        // OpenAI TTS returns raw audio data
        const endpoint = `${this.serverUrl}/v1/audio/speech`;
        
        return this.limiter.execute(async () => {
          return this.circuitBreaker.execute(async () => {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify({
                model: req.body.model,
                input: req.body.input,
                voice: req.body.voice,
                response_format: req.body.response_format || 'mp3',
                speed: req.body.speed,
              }),
              signal: AbortSignal.timeout(60000),
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw normalizeError({ status: response.status, ...error }, 'openai');
            }
            
            // OpenAI returns raw audio buffer
            return Buffer.from(await response.arrayBuffer());
          });
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT transform request (OpenAI is the standard)
  - Do NOT add retry logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Adapter pattern, follows existing conventions
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T17, T18, T19, T20)
  - **Blocks**: T17, T18
  - **Blocked By**: T6, T7, T8, T12, T13

- [ ] T17. Add POST /v1/audio/speech handler

  **What to do**:
  - Create `src/controllers/audio-controller.ts`:
    ```typescript
    import { Request, Response } from 'express';
    import { getOrchestratorInstance } from '../orchestrator';
    import { asyncTaskStore } from '../utils/async-task-store';
    import { MiniMaxTTSAdapter } from '../adapters/tts/minimax.adapter';
    import { OpenAITTSAdapter } from '../adapters/tts/openai.adapter';
    import { logger } from '../utils/logger';
    
    export async function handleAudioSpeech(req: Request, res: Response): Promise<void> {
      const orchestrator = getOrchestratorInstance();
      const { model, input, voice, response_format } = req.body;
      
      try {
        // Select server with audio support
        const servers = orchestrator.getServers().filter(s => 
          s.supportsAudio && s.healthy && !s.draining && !s.maintenance
        );
        
        if (servers.length === 0) {
          res.status(503).json({
            error: {
              message: 'No servers available with audio synthesis support',
              code: 'NO_AUDIO_SERVERS',
            },
          });
          return;
        }
        
        // Select server (simple round-robin for now, could use load balancer)
        const server = servers[0];
        
        // Determine provider based on server type or URL
        const isMiniMax = server.url.includes('minimax');
        const adapter = isMiniMax
          ? new MiniMaxTTSAdapter(server.url, server.apiKey || '')
          : new OpenAITTSAdapter(server.url, server.apiKey || '');
        
        // For synchronous TTS, wait for result
        const audioBuffer = await adapter.synthesize(req);
        
        // Set content type based on format
        const format = response_format || 'mp3';
        const contentTypes: Record<string, string> = {
          'mp3': 'audio/mpeg',
          'wav': 'audio/wav',
          'opus': 'audio/opus',
          'aac': 'audio/aac',
        };
        
        res.set('Content-Type', contentTypes[format] || 'audio/mpeg');
        res.set('Content-Length', audioBuffer.length.toString());
        res.send(audioBuffer);
        
      } catch (error) {
        logger.error('TTS synthesis failed:', { error, model, voice });
        const normalized = normalizeError(error, 'tts');
        res.status(normalized.statusCode || 500).json({
          error: {
            message: normalized.message,
            code: normalized.code,
          },
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT block waiting for async tasks in this handler (return immediately for async)
  - Do NOT cache audio results

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Controller logic with multiple concerns
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T18, T19, T20)
  - **Blocks**: T19, T20
  - **Blocked By**: T14, T15, T16

- [ ] T18. Add GET /v1/tasks/:taskId polling endpoint

  **What to do**:
  - Add to `src/controllers/audio-controller.ts` or create `src/controllers/tasks-controller.ts`:
    ```typescript
    export async function handleGetTask(req: Request, res: Response): Promise<void> {
      const { taskId } = req.params;
      
      const task = asyncTaskStore.get(taskId);
      if (!task) {
        res.status(404).json({
          error: {
            message: `Task ${taskId} not found`,
            code: 'TASK_NOT_FOUND',
          },
        });
        return;
      }
      
      // If task is still pending/in_progress, check provider for updated status
      if (task.status === 'PENDING' || task.status === 'IN_PROGRESS') {
        const updatedTask = await checkTaskStatus(task);
        asyncTaskStore.update(taskId, updatedTask);
        res.json(formatTaskResponse(updatedTask));
        return;
      }
      
      // Return cached result
      res.json(formatTaskResponse(task));
    }
    
    async function checkTaskStatus(task: AsyncTask): Promise<Partial<AsyncTask>> {
      // Call provider's status endpoint based on modality
      // This is provider-specific polling
      // For now, return unchanged - async polling handled separately
      return { status: task.status };
    }
    
    function formatTaskResponse(task: AsyncTask): object {
      return {
        id: task.id,
        status: task.status,
        createdAt: task.createdAt,
        completedAt: task.completedAt,
        result: task.result,
        error: task.error,
      };
    }
    ```

  **Must NOT do**:
  - Do NOT implement full polling logic here (just status check)
  - Do NOT update task status without provider confirmation

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Task polling state management
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T17, T19, T20)
  - **Blocks**: T19
  - **Blocked By**: T15, T16

- [ ] T19. Add DELETE /v1/tasks/:taskId cancel endpoint

  **What to do**:
  - Add to `src/controllers/tasks-controller.ts`:
    ```typescript
    export async function handleCancelTask(req: Request, res: Response): Promise<void> {
      const { taskId } = req.params;
      
      const task = asyncTaskStore.get(taskId);
      if (!task) {
        res.status(404).json({
          error: {
            message: `Task ${taskId} not found`,
            code: 'TASK_NOT_FOUND',
          },
        });
        return;
      }
      
      // Can only cancel PENDING tasks
      if (task.status !== 'PENDING') {
        res.status(400).json({
          error: {
            message: `Cannot cancel task in ${task.status} state`,
            code: 'TASK_NOT_CANCELLABLE',
          },
        });
        return;
      }
      
      // Mark as cancelled
      asyncTaskStore.updateStatus(taskId, 'CANCELLED');
      
      res.json({
        id: taskId,
        status: 'CANCELLED',
        message: 'Task cancelled successfully',
      });
    }
    ```

  **Must NOT do**:
  - Do NOT try to cancel tasks already IN_PROGRESS or COMPLETED

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple CRUD operation
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T17, T18, T20)
  - **Blocked By**: T18

- [ ] T20. Add TTS to /v1/models response

  **What to do**:
  - Edit `src/controllers/openai-controller.ts` handleListModels:
    - Include TTS models in the response when server supportsAudio
    - Map model names to OpenAI-compatible names in response

  **Must NOT do**:
  - Do NOT list all TTS models if server only supports specific ones

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple model list extension
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with T14, T15, T16, T17, T18, T19)
  - **Blocked By**: T17

- [ ] T21. Add image models to provider-defaults

  **What to do**:
  - Edit `src/config/provider-defaults.ts`:
    ```typescript
    // MiniMax image models
    MINIMAX_IMAGE_MODELS: ['image-01'],
    
    // OpenAI image models
    OPENAI_IMAGE_MODELS: ['gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'],
    ```

  **Must NOT do**:
  - Do NOT add video models here

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple constant addition
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T22, T23, T24, T25, T26, T27)
  - **Blocks**: T24
  - **Blocked By**: T6, T7, T11

- [ ] T22. Implement MiniMax image adapter

  **What to do**:
  - Create `src/adapters/images/minimax.adapter.ts`:
    ```typescript
    import { Request } from 'express';
    import { transformImagesRequestToMiniMax, transformImagesResponseFromMiniMax } from '../transform-request';
    import { circuitBreakerRegistry } from '../../utils/circuit-breaker-multimodal';
    import { concurrencyLimiterRegistry } from '../../utils/concurrency-limiter';
    import { normalizeError } from '../../utils/error-normalizer';
    
    export class MiniMaxImageAdapter {
      private serverUrl: string;
      private apiKey: string;
      private circuitBreaker = circuitBreakerRegistry.getOrCreate('minimax');
      private limiter = concurrencyLimiterRegistry.getOrCreate('minimax', 3);
      
      constructor(serverUrl: string, apiKey: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
      }
      
      async generate(req: Request): Promise<object> {
        const endpoint = `${this.serverUrl}/v1/image_generation`;
        
        return this.limiter.execute(async () => {
          return this.circuitBreaker.execute(async () => {
            const miniMaxRequest = transformImagesRequestToMiniMax(req);
            
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(miniMaxRequest),
              signal: AbortSignal.timeout(120000), // 2min timeout for images
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw normalizeError({ status: response.status, ...error }, 'minimax');
            }
            
            const data = await response.json();
            return transformImagesResponseFromMiniMax(data);
          });
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT implement image edits or variations (T25, T26)
  - Do NOT cache URLs

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Adapter pattern
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T23, T24, T25, T26, T27)
  - **Blocks**: T24, T25
  - **Blocked By**: T6, T7, T8, T12, T13

- [ ] T23. Implement OpenAI image adapter

  **What to do**:
  - Create `src/adapters/images/openai.adapter.ts`:
    ```typescript
    import { Request } from 'express';
    import { circuitBreakerRegistry } from '../../utils/circuit-breaker-multimodal';
    import { concurrencyLimiterRegistry } from '../../utils/concurrency-limiter';
    import { normalizeError } from '../../utils/error-normalizer';
    
    export class OpenAIImageAdapter {
      private serverUrl: string;
      private apiKey: string;
      private circuitBreaker = circuitBreakerRegistry.getOrCreate('openai');
      private limiter = concurrencyLimiterRegistry.getOrCreate('openai', 5);
      
      constructor(serverUrl: string, apiKey: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
      }
      
      async generate(req: Request): Promise<object> {
        const endpoint = `${this.serverUrl}/v1/images/generations`;
        
        return this.limiter.execute(async () => {
          return this.circuitBreaker.execute(async () => {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify({
                model: req.body.model,
                prompt: req.body.prompt,
                n: req.body.n,
                size: req.body.size,
                response_format: req.body.response_format,
                style: req.body.style,
              }),
              signal: AbortSignal.timeout(120000),
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw normalizeError({ status: response.status, ...error }, 'openai');
            }
            
            return response.json();
          });
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT transform request (OpenAI is standard format)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Adapter pattern
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T24, T25, T26, T27)
  - **Blocks**: T24, T25
  - **Blocked By**: T6, T7, T8, T12, T13

- [ ] T24. Add POST /v1/images/generations handler

  **What to do**:
  - Create `src/controllers/images-controller.ts`:
    ```typescript
    import { Request, Response } from 'express';
    import { getOrchestratorInstance } from '../orchestrator';
    import { MiniMaxImageAdapter } from '../adapters/images/minimax.adapter';
    import { OpenAIImageAdapter } from '../adapters/images/openai.adapter';
    import { logger } from '../utils/logger';
    
    export async function handleImageGenerations(req: Request, res: Response): Promise<void> {
      const orchestrator = getOrchestratorInstance();
      const { model, prompt, n, size, response_format } = req.body;
      
      try {
        // Select server with image support
        const servers = orchestrator.getServers().filter(s => 
          s.supportsImages && s.healthy && !s.draining && !s.maintenance
        );
        
        if (servers.length === 0) {
          res.status(503).json({
            error: {
              message: 'No servers available with image generation support',
              code: 'NO_IMAGE_SERVERS',
            },
          });
          return;
        }
        
        const server = servers[0];
        const isMiniMax = server.url.includes('minimax');
        const adapter = isMiniMax
          ? new MiniMaxImageAdapter(server.url, server.apiKey || '')
          : new OpenAIImageAdapter(server.url, server.apiKey || '');
        
        const result = await adapter.generate(req);
        
        res.json(result);
        
      } catch (error) {
        logger.error('Image generation failed:', { error, model });
        const normalized = normalizeError(error, 'images');
        res.status(normalized.statusCode || 500).json({
          error: {
            message: normalized.message,
            code: normalized.code,
          },
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT implement streaming (not supported for images)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Controller logic
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T23, T25, T26, T27)
  - **Blocks**: T25, T26, T27
  - **Blocked By**: T21, T22, T23

- [ ] T25. Add POST /v1/images/edits handler

  **What to do**:
  - Add to `src/controllers/images-controller.ts`:
    ```typescript
    export async function handleImageEdits(req: Request, res: Response): Promise<void> {
      // Similar to handleImageGenerations but for edits
      // For MiniMax, this maps to image_generation with reference image
      // For OpenAI, uses /v1/images/edits endpoint
      
      const orchestrator = getOrchestratorInstance();
      // ... similar server selection logic
      
      // Implementation differs per provider
      // MiniMax: Uses image_generation with subject_reference
      // OpenAI: Uses /v1/images/edits
      
      res.status(501).json({
        error: {
          message: 'Image edits not yet implemented',
          code: 'NOT_IMPLEMENTED',
        },
      });
    }
    ```

  **Must NOT do**:
  - Do NOT implement fully if not all providers support it

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Provider-specific logic
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T23, T24, T26, T27)
  - **Blocks**: T27
  - **Blocked By**: T24

- [ ] T26. Add POST /v1/images/variations handler

  **What to do**:
  - Add to `src/controllers/images-controller.ts`:
    ```typescript
    export async function handleImageVariations(req: Request, res: Response): Promise<void> {
      // Similar to handleImageGenerations but for variations
      // Uses /v1/images/variations for OpenAI
      // MiniMax doesn't have direct equivalent - could use image_generation
      
      res.status(501).json({
        error: {
          message: 'Image variations not yet implemented',
          code: 'NOT_IMPLEMENTED',
        },
      });
    }
    ```

  **Must NOT do**:
  - Do NOT implement fully without MiniMax equivalent research

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Stub implementation
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T23, T24, T25, T27)
  - **Blocked By**: T24

- [ ] T27. Add image models to /v1/models response

  **What to do**:
  - Edit `src/controllers/openai-controller.ts` handleListModels to include image models

  **Must NOT do**:
  - Do NOT list image models if server doesn't support images

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple model list extension
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with T21, T22, T23, T24, T25, T26)
  - **Blocked By**: T24

- [ ] T28. Add video models to provider-defaults

  **What to do**:
  - Edit `src/config/provider-defaults.ts`:
    ```typescript
    // MiniMax video models
    MINIMAX_VIDEO_MODELS: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'],
    ```

  **Must NOT do**:
  - Do NOT add music generation models

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple constant addition
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T29, T30, T31, T32, T33)
  - **Blocks**: T30
  - **Blocked By**: T6, T7, T11

- [ ] T29. Implement MiniMax video adapter (submit + poll)

  **What to do**:
  - Create `src/adapters/video/minimax.adapter.ts`:
    ```typescript
    import { Request } from 'express';
    import { transformVideoRequestToMiniMax, transformVideoResultFromMiniMax } from '../transform-request';
    import { circuitBreakerRegistry } from '../../utils/circuit-breaker-multimodal';
    import { concurrencyLimiterRegistry } from '../../utils/concurrency-limiter';
    import { normalizeError } from '../../utils/error-normalizer';
    import { AsyncTaskStore } from '../../utils/async-task-store';
    import { calculateBackoff } from '../../utils/backoff';
    
    export class MiniMaxVideoAdapter {
      private serverUrl: string;
      private apiKey: string;
      private circuitBreaker = circuitBreakerRegistry.getOrCreate('minimax');
      private limiter = concurrencyLimiterRegistry.getOrCreate('minimax', 2);
      
      constructor(serverUrl: string, apiKey: string) {
        this.serverUrl = serverUrl;
        this.apiKey = apiKey;
      }
      
      async submitTask(req: Request, taskStore: AsyncTaskStore): Promise<{ task_id: string }> {
        const endpoint = `${this.serverUrl}/v1/video_generation`;
        
        return this.limiter.execute(async () => {
          return this.circuitBreaker.execute(async () => {
            const miniMaxRequest = transformVideoRequestToMiniMax(req);
            
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify(miniMaxRequest),
              signal: AbortSignal.timeout(30000), // 30s for submission
            });
            
            if (!response.ok) {
              const error = await response.json().catch(() => ({}));
              throw normalizeError({ status: response.status, ...error }, 'minimax');
            }
            
            const data = await response.json();
            
            // Create async task in store
            const task = taskStore.create({
              model: req.body.model,
              modality: 'video',
              provider: 'minimax',
              serverId: 'minimax', // Would use actual serverId
              metadata: { task_id: data.task_id },
            });
            
            return { task_id: task.id };
          });
        });
      }
      
      async pollTask(taskId: string, taskStore: AsyncTaskStore): Promise<object> {
        const task = taskStore.get(taskId);
        if (!task) {
          throw new Error('Task not found');
        }
        
        const miniMaxTaskId = task.metadata?.task_id;
        const queryEndpoint = `${this.serverUrl}/v1/query/video_generation?task_id=${miniMaxTaskId}`;
        
        const response = await fetch(queryEndpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          },
          signal: AbortSignal.timeout(10000),
        });
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw normalizeError({ status: response.status, ...error }, 'minimax');
        }
        
        const data = await response.json();
        
        // Update task status in store
        if (data.status === 'SUCCESS') {
          taskStore.updateStatus(taskId, 'COMPLETED', {
            completedAt: new Date(),
            result: {
              videoUrl: data.data?.video_url || data.file_id,
            },
          });
        } else if (data.status === 'FAIL') {
          taskStore.updateStatus(taskId, 'FAILED', {
            completedAt: new Date(),
            error: {
              code: 'VIDEO_GENERATION_FAILED',
              message: data.error?.message || 'Video generation failed',
            },
          });
        } else {
          taskStore.updateStatus(taskId, 'IN_PROGRESS');
        }
        
        return transformVideoResultFromMiniMax(data);
      }
      
      // Poll with exponential backoff
      async pollWithBackoff(taskId: string, taskStore: AsyncTaskStore): Promise<object> {
        const maxAttempts = 150; // ~5 min at 2s intervals
        let attempts = 0;
        
        while (attempts < maxAttempts) {
          const result = await this.pollTask(taskId, taskStore);
          const updatedTask = taskStore.get(taskId);
          
          if (updatedTask?.status === 'COMPLETED' || updatedTask?.status === 'FAILED') {
            return result;
          }
          
          const interval = calculateBackoff(attempts, {
            initialIntervalMs: 2000,
            maxIntervalMs: 15000,
            backoffFactor: 1.2,
            jitterFactor: 0.1,
          });
          
          await new Promise(resolve => setTimeout(resolve, interval));
          attempts++;
        }
        
        throw new Error('Video generation timed out');
      }
    }
    ```

  **Must NOT do**:
  - Do NOT block the request waiting for completion (return task_id immediately)
  - Do NOT cache video URLs (expire in 24h)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Reason**: Complex async polling with backoff
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T28, T30, T31, T32, T33)
  - **Blocks**: T30, T31
  - **Blocked By**: T6, T7, T8, T12, T13

- [ ] T30. Add POST /v1/video/generations handler

  **What to do**:
  - Create `src/controllers/video-controller.ts`:
    ```typescript
    import { Request, Response } from 'express';
    import { getOrchestratorInstance } from '../orchestrator';
    import { asyncTaskStore } from '../utils/async-task-store';
    import { MiniMaxVideoAdapter } from '../adapters/video/minimax.adapter';
    import { logger } from '../utils/logger';
    
    export async function handleVideoGenerations(req: Request, res: Response): Promise<void> {
      const orchestrator = getOrchestratorInstance();
      const { model, prompt } = req.body;
      
      try {
        // Select server with video support
        const servers = orchestrator.getServers().filter(s => 
          s.supportsVideo && s.healthy && !s.draining && !s.maintenance
        );
        
        if (servers.length === 0) {
          res.status(503).json({
            error: {
              message: 'No servers available with video generation support',
              code: 'NO_VIDEO_SERVERS',
            },
          });
          return;
        }
        
        const server = servers[0];
        const isMiniMax = server.url.includes('minimax');
        
        if (!isMiniMax) {
          res.status(501).json({
            error: {
              message: 'Video generation only supported for MiniMax in v1',
              code: 'NOT_SUPPORTED',
            },
          });
          return;
        }
        
        const adapter = new MiniMaxVideoAdapter(server.url, server.apiKey || '');
        const { task_id } = await adapter.submitTask(req, asyncTaskStore);
        
        // Return 202 Accepted with task_id for polling
        res.status(202).json({
          id: task_id,
          status: 'PENDING',
          created: Math.floor(Date.now() / 1000),
        });
        
      } catch (error) {
        logger.error('Video generation submission failed:', { error, model });
        const normalized = normalizeError(error, 'video');
        res.status(normalized.statusCode || 500).json({
          error: {
            message: normalized.message,
            code: normalized.code,
          },
        });
      }
    }
    ```

  **Must NOT do**:
  - Do NOT wait for video completion (return task_id immediately)
  - Do NOT support multiple providers yet

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Controller logic
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T28, T29, T31, T32, T33)
  - **Blocks**: T31, T32, T33
  - **Blocked By**: T28, T29

- [ ] T31. Add GET /v1/tasks/:taskId polling endpoint

  **What to do**:
  - Add to `src/controllers/video-controller.ts`:
    ```typescript
    export async function handleGetVideoTask(req: Request, res: Response): Promise<void> {
      const { taskId } = req.params;
      
      const task = asyncTaskStore.get(taskId);
      if (!task) {
        res.status(404).json({
          error: {
            message: `Task ${taskId} not found`,
            code: 'TASK_NOT_FOUND',
          },
        });
        return;
      }
      
      if (task.modality !== 'video') {
        res.status(400).json({
          error: {
            message: `Task ${taskId} is not a video task`,
            code: 'INVALID_TASK_TYPE',
          },
        });
        return;
      }
      
      // If still pending/in_progress, poll provider
      if (task.status === 'PENDING' || task.status === 'IN_PROGRESS') {
        const server = getOrchestratorInstance().getServers()[0]; // Would use serverId from task
        const adapter = new MiniMaxVideoAdapter(server.url, server.apiKey || '');
        
        try {
          await adapter.pollWithBackoff(taskId, asyncTaskStore);
        } catch (error) {
          // Log but don't fail - return current status
          logger.error('Video polling failed:', { error, taskId });
        }
      }
      
      // Return updated task
      const updatedTask = asyncTaskStore.get(taskId);
      res.json({
        id: updatedTask!.id,
        status: updatedTask!.status,
        createdAt: updatedTask!.createdAt,
        completedAt: updatedTask!.completedAt,
        result: updatedTask!.result,
        error: updatedTask!.error,
      });
    }
    ```

  **Must NOT do**:
  - Do NOT poll more than necessary (use backoff)
  - Do NOT block indefinitely

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Polling logic with state management
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T28, T29, T30, T32, T33)
  - **Blocks**: T32
  - **Blocked By**: T29, T30

- [ ] T32. Add DELETE /v1/tasks/:taskId cancel endpoint

  **What to do**:
  - Add to `src/controllers/video-controller.ts`:
    ```typescript
    export async function handleCancelVideoTask(req: Request, res: Response): Promise<void> {
      const { taskId } = req.params;
      
      const task = asyncTaskStore.get(taskId);
      if (!task) {
        res.status(404).json({
          error: {
            message: `Task ${taskId} not found`,
            code: 'TASK_NOT_FOUND',
          },
        });
        return;
      }
      
      if (task.modality !== 'video') {
        res.status(400).json({
          error: {
            message: `Task ${taskId} is not a video task`,
            code: 'INVALID_TASK_TYPE',
          },
        });
        return;
      }
      
      // Can only cancel PENDING tasks (once IN_PROGRESS, cannot cancel)
      if (task.status !== 'PENDING') {
        res.status(400).json({
          error: {
            message: `Cannot cancel task in ${task.status} state`,
            code: 'TASK_NOT_CANCELLABLE',
          },
        });
        return;
      }
      
      asyncTaskStore.updateStatus(taskId, 'CANCELLED');
      
      res.json({
        id: taskId,
        status: 'CANCELLED',
        message: 'Video generation task cancelled',
      });
    }
    ```

  **Must NOT do**:
  - Do NOT try to cancel via provider API (PENDING only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple CRUD
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T28, T29, T30, T31, T33)
  - **Blocked By**: T31

- [ ] T33. Add video models to /v1/models response

  **What to do**:
  - Edit `src/controllers/openai-controller.ts` handleListModels to include video models

  **Must NOT do**:
  - Do NOT list video models if server doesn't support video

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Simple model list extension
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with T28, T29, T30, T31, T32)
  - **Blocked By**: T30

- [ ] T34. Update OpenAPI schema for multimodal endpoints

  **What to do**:
  - Edit OpenAPI/schema files to add:
    - `POST /v1/audio/speech` - TTS endpoint
    - `POST /v1/images/generations` - Image generation
    - `POST /v1/images/edits` - Image editing
    - `POST /v1/images/variations` - Image variations
    - `POST /v1/video/generations` - Video generation
    - `GET /v1/tasks/:taskId` - Task status
    - `DELETE /v1/tasks/:taskId` - Task cancellation
  - Include request/response schemas for each

  **Must NOT do**:
  - Do NOT change existing chat/completions/embeddings schemas

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Documentation/update
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T35, T36, T37, T38, T39, T40, T41)
  - **Blocks**: T35
  - **Blocked By**: T20, T27, T33

- [ ] T35. Update servers-controller.ts types

  **What to do**:
  - Edit `src/controllers/servers-controller.ts` getServers handler:
    - Return `supportsImages`, `supportsAudio`, `supportsVideo` fields
    - Return `endpointOverrides` for multimodal paths
    - Already done in previous work, verify completeness

  **Must NOT do**:
  - Do NOT change existing fields

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Reason**: Type verification
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T36, T37, T38, T39, T40, T41)
  - **Blocks**: T36, T37
  - **Blocked By**: T34

- [ ] T36. Update frontend AddServer modal with multimodal options

  **What to do**:
  - Edit `frontend/src/pages/Servers.tsx` or related:
    - Add checkbox/toggle for "Supports Image Generation"
    - Add checkbox/toggle for "Supports Audio/TTS"
    - Add checkbox/toggle for "Supports Video Generation"
    - Add optional endpoint override fields for each modality
    - Show these options when adding a new server

  **Must NOT do**:
  - Do NOT make these fields required (can be auto-detected)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Reason**: Frontend UI component
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T37, T38, T39, T40, T41)
  - **Blocks**: T38
  - **Blocked By**: T35

- [ ] T37. Update frontend ServerCard with multimodal badges

  **What to do**:
  - Edit `frontend/src/components/ServerCard.tsx` or related:
    - Add badges for: 🎨 Images, 🔊 Audio, 🎬 Video
    - Show which modalities the server supports
    - Use colors to indicate capability status

  **Must NOT do**:
  - Do NOT change existing server card structure

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Reason**: Frontend UI component
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T36, T38, T39, T40, T41)
  - **Blocks**: T38
  - **Blocked By**: T35

- [ ] T38. Add multimodal capability detection to frontend

  **What to do**:
  - Edit frontend API layer:
    - Update `frontend/src/api.ts` to fetch new server fields
    - Update server type definitions to include multimodal capabilities
    - Update server selection logic to consider multimodal support

  **Must NOT do**:
  - Do NOT change existing API methods

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Reason**: Frontend API integration
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T36, T37, T39, T40, T41)
  - **Blocks**: T39, T40, T41
  - **Blocked By**: T36, T37

- [ ] T39. Integration test: TTS end-to-end with mock

  **What to do**:
  - Create `tests/integration/multimodal/tts.test.ts`:
    - Mock MiniMax TTS endpoint
    - Test `POST /v1/audio/speech` with MiniMax server
    - Verify correct request transformation
    - Verify audio buffer returned correctly
    - Test error handling (auth failure, rate limit, etc.)

  **Must NOT do**:
  - Do NOT test against real MiniMax API (use mocks)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Integration testing
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T36, T37, T38, T40, T41)
  - **Blocks**: F1
  - **Blocked By**: T20, T38

- [ ] T40. Integration test: Images end-to-end with mock

  **What to do**:
  - Create `tests/integration/multimodal/images.test.ts`:
    - Mock MiniMax and OpenAI image endpoints
    - Test `POST /v1/images/generations`
    - Verify correct request transformation
    - Verify image URLs returned
    - Test n=multiple images

  **Must NOT do**:
  - Do NOT test against real provider APIs

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Integration testing
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T36, T37, T38, T39, T41)
  - **Blocks**: F1
  - **Blocked By**: T27, T38

- [ ] T41. Integration test: Video end-to-end with mock

  **What to do**:
  - Create `tests/integration/multimodal/video.test.ts`:
    - Mock MiniMax video endpoints (submit + poll)
    - Test `POST /v1/video/generations` returns task_id
    - Test `GET /v1/tasks/:taskId` polling
    - Test exponential backoff
    - Test COMPLETED status with video URL

  **Must NOT do**:
  - Do NOT test against real MiniMax API

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Reason**: Integration testing
  - **Skills**: None required

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 6 (with T34, T35, T36, T37, T38, T39, T40)
  - **Blocks**: F1
  - **Blocked By**: T33, T38

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `npm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Test edge cases: empty state, invalid input, rapid actions.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Description | Files |
|--------|-------------|-------|
| 1 | `feat(multimodal): add AIServer capability flags and AsyncTask types` | src/orchestrator/orchestrator.types.ts, src/types/async-task.types.ts |
| 2 | `feat(multimodal): add endpointOverrides for multimodal paths` | src/orchestrator/orchestrator.types.ts, src/config/schema.ts |
| 3 | `feat(multimodal): implement AsyncTaskStore and exponential backoff` | src/utils/async-task-store.ts, src/utils/backoff.ts |
| 4 | `feat(multimodal): add circuit breaker and concurrency limiter` | src/utils/circuit-breaker-multimodal.ts, src/utils/concurrency-limiter.ts |
| 5 | `feat(multimodal): add error normalization utilities` | src/utils/error-normalizer.ts |
| 6 | `feat(multimodal): extend health check for multimodal probes` | src/health-check-scheduler.ts |
| 7 | `feat(multimodal): add request/response transformation utilities` | src/adapters/transform-request.ts, src/adapters/transform-response.ts |
| 8 | `feat(multimodal): add TTS adapters and /v1/audio/speech handler` | src/controllers/audio-controller.ts, src/adapters/tts/*.ts |
| 9 | `feat(multimodal): add image generation adapters and handlers` | src/controllers/images-controller.ts, src/adapters/images/*.ts |
| 10 | `feat(multimodal): add video generation adapters and handlers` | src/controllers/video-controller.ts, src/adapters/video/*.ts |
| 11 | `feat(multimodal): add multimodal constants and provider defaults` | src/constants/api-endpoints.ts, src/config/provider-defaults.ts |
| 12 | `feat(multimodal): add frontend multimodal support` | frontend/src/... |
| 13 | `test(multimodal): add integration tests` | tests/integration/multimodal/*.ts |

---

## Success Criteria

### Verification Commands

```bash
# TTS endpoint - produces audio
curl -X POST http://localhost:5100/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"speech-2.8-hd","input":"Hello world","voice":"English_Graceful_Lady"}' \
  --output test.mp3
file test.mp3  # Should be audio file

# Check task status (for async tasks)
curl http://localhost:5100/v1/tasks/{task_id}
# Returns: {"id":"...","status":"PENDING|IN_PROGRESS|COMPLETED|FAILED",...}

# Image generation - produces image URLs
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"A red car","n":1}'
# Returns: {"created":...,"data":[{"url":"...","b64_json":null}]}

# Video generation - returns task_id immediately
curl -X POST http://localhost:5100/v1/video/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-Hailuo-2.3","prompt":"A dog running"}'
# Returns: {"id":"...","status":"PENDING","created":...}

# Poll video status
curl http://localhost:5100/v1/tasks/{task_id}
# Returns: {"id":"...","status":"COMPLETED","result":{"videoUrl":"..."}}
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] TTS produces audio output
- [ ] Image generation produces image URL
- [ ] Video generation returns task_id and completes via polling
- [ ] Exponential backoff with jitter verified
- [ ] Per-provider circuit breakers working
- [ ] Concurrency limits enforced

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + tests. Review all changed files for `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code.

- [ ] F3. **Real Manual QA** — `unspecified-high` + `playwright` skill if UI
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration.

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — no missing, no creep.

---

## Commit Strategy

- **1**: `feat(multimodal): add AIServer capability flags and AsyncTask types` - src/orchestrator/orchestrator.types.ts, src/types/api-request.types.ts
- **2**: `feat(multimodal): add endpointOverrides for multimodal paths` - src/config/schema.ts, src/orchestrator/orchestrator.types.ts
- **3**: `feat(multimodal): implement AsyncTaskStore and exponential backoff` - src/utils/async-task-store.ts, src/utils/backoff.ts
- **4**: `feat(multimodal): add circuit breaker and concurrency limiter` - src/utils/circuit-breaker.ts, src/utils/concurrency-limiter.ts
- **5**: `feat(multimodal): extend health check for multimodal probes` - src/health-check-scheduler.ts
- **6**: `feat(multimodal): add TTS adapters and /v1/audio/speech handler` - src/controllers/audio-controller.ts (new), src/adapters/tts/minimax.adapter.ts, src/adapters/tts/openai.adapter.ts
- **7**: `feat(multimodal): add image generation adapters and handlers` - src/controllers/images-controller.ts (new), src/adapters/images/minimax.adapter.ts, src/adapters/images/openai.adapter.ts
- **8**: `feat(multimodal): add video generation adapters and handlers` - src/controllers/video-controller.ts (new), src/adapters/video/minimax.adapter.ts
- **9**: `feat(multimodal): add frontend multimodal support` - frontend/src/...
- **10**: `test(multimodal): add integration tests` - tests/integration/multimodal/

---

## Success Criteria

### Verification Commands

```bash
# TTS endpoint
curl -X POST http://localhost:5100/v1/audio/speech \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"speech-2.8-hd","input":"Hello world","voice":"English_Graceful_Lady"}' \
  --output test.mp3

# Check task status
curl http://localhost:5100/v1/tasks/{task_id}

# Image generation
curl -X POST http://localhost:5100/v1/images/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"A red car","n":1}'

# Video generation (async)
curl -X POST http://localhost:5100/v1/video/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-Hailuo-2.3","prompt":"A dog running"}'
# Returns: {"task_id":"...","status":"PENDING"}

# Poll video status
curl http://localhost:5100/v1/tasks/{task_id}
# Returns: {"task_id":"...","status":"COMPLETED","result":{"video_url":"..."}}
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] TTS produces audio output
- [ ] Image generation produces image URL
- [ ] Video generation returns task_id and completes via polling
- [ ] Exponential backoff with jitter verified
- [ ] Per-provider circuit breakers working
- [ ] Concurrency limits enforced