/**
 * model-manager.ts
 * Model warmup and cold start management system
 */

import { ERROR_MESSAGES } from './constants/index.js';
import type { AIServer } from './orchestrator.types.js';
import { getErrorClassifier } from './utils/errorClassifier.js';
import { fetchWithTimeout } from './utils/fetchWithTimeout.js';
import { logger } from './utils/logger.js';

/** Response shape from Ollama /api/generate endpoint */
interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
}

/** Response shape from Ollama /api/show endpoint */
interface OllamaShowResponse {
  size?: number;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
  };
}

/** Individual process entry from Ollama /api/ps */
interface OllamaProcessEntry {
  model?: string;
  name?: string;
  size_vram?: number;
  vram?: number;
}

/** Response shape from Ollama /api/ps endpoint */
interface OllamaProcessListResponse {
  models?: OllamaProcessEntry[];
}

/** Server status entry in warmup status result */
interface ServerWarmupStatusEntry {
  loaded: boolean;
  loading: boolean;
  lastUsed?: number;
  loadTime?: number;
  gpuMemory?: number;
}

export interface ModelLoadingState {
  model: string;
  loaded: boolean;
  loading: boolean;
  loadTime: number; // Time to load model in ms (0 if unknown)
  lastUsed: number; // Timestamp of last request
  size: number; // Model size in GB (0 if unknown)
  parameters?: string; // e.g., "8b", "70b"
  quantization?: string; // e.g., "q4_0", "q8_0"
  gpuMemory: number; // GPU memory used in MB
  errorCount: number;
  lastError?: string;
  warmupTime?: number; // When model was warmed up
}

export interface ServerModelState {
  serverId: string;
  serverUrl: string; // Added: Server URL for API calls
  lastUpdated: number;
  models: Map<string, ModelLoadingState>;
  totalGpuMemory: number;
  availableGpuMemory: number;
  loadedModelsMemory: number; // Added: Memory used by loaded models
}

export interface WarmupJob {
  id: string;
  model: string;
  serverId: string;
  status: 'pending' | 'loading' | 'loaded' | 'failed' | 'cancelled';
  priority: 'low' | 'normal' | 'high';
  startTime: number;
  endTime?: number;
  estimatedTime: number;
  progress: number; // 0-100 progress percentage
  error?: string;
  abortController?: AbortController; // For cancellation support
}

export interface WarmupResult {
  model: string;
  jobs: Array<{
    serverId: string;
    status: WarmupJob['status'];
    estimatedTime: number;
    loadTime?: number;
  }>;
  totalServers: number;
  loadedOn: number;
  loadingOn: number;
  failedOn: number;
}

/**
 * Configuration for the Model Manager
 */
export interface ModelManagerConfig {
  maxRetries: number; // Max retry attempts for warmup (default: 3)
  retryDelayBaseMs: number; // Base delay for exponential backoff (default: 1000)
  warmupTimeoutMs: number; // Timeout for warmup requests (default: 60000)
  idleThresholdMs: number; // Idle time before model can be unloaded (default: 1800000)
  memorySafetyMargin: number; // Memory safety margin multiplier (default: 1.2)
  gbPerBillionParams: number; // Estimated GB per billion parameters (default: 0.75)
  defaultModelSizeGb: number; // Default model size if unknown (default: 5)
  loadTimeEstimates: {
    tiny: number; // < 1B parameters (default: 3000)
    small: number; // 1-7B parameters (default: 5000)
    medium: number; // 7-13B parameters (default: 10000)
    large: number; // 13-30B parameters (default: 20000)
    xl: number; // 30-70B parameters (default: 40000)
    xxl: number; // > 70B parameters (default: 80000)
  };
}

export const DEFAULT_MODEL_MANAGER_CONFIG: ModelManagerConfig = {
  maxRetries: 3,
  retryDelayBaseMs: 1000,
  warmupTimeoutMs: 60000,
  idleThresholdMs: 1800000, // 30 minutes
  memorySafetyMargin: 1.2,
  gbPerBillionParams: 0.75,
  defaultModelSizeGb: 5,
  loadTimeEstimates: {
    tiny: 3000,
    small: 5000,
    medium: 10000,
    large: 20000,
    xl: 40000,
    xxl: 80000,
  },
};

/**
 * Manages model loading state across all servers
 */
export class ModelManager {
  private serverStates: Map<string, ServerModelState> = new Map();
  private warmupJobs: Map<string, WarmupJob> = new Map();
  private jobCounter = 0;
  private config: ModelManagerConfig;

  constructor(config: Partial<ModelManagerConfig> = {}) {
    this.config = { ...DEFAULT_MODEL_MANAGER_CONFIG, ...config };
  }

  /**
   * Register a server with the model manager
   */
  registerServer(server: AIServer): void {
    if (!this.serverStates.has(server.id)) {
      this.serverStates.set(server.id, {
        serverId: server.id,
        serverUrl: server.url,
        lastUpdated: Date.now(),
        models: new Map(),
        totalGpuMemory: 0,
        availableGpuMemory: 0,
        loadedModelsMemory: 0,
      });
      logger.info(`Registered server ${server.id} with model manager`);
    }
  }

  /**
   * Unregister a server
   */
  unregisterServer(serverId: string): void {
    this.serverStates.delete(serverId);
    // Clean up any pending jobs for this server
    for (const job of this.warmupJobs.values()) {
      if (job.serverId === serverId && job.status === 'pending') {
        job.status = 'failed';
        job.error = 'Server unregistered';
        job.endTime = Date.now();
      }
    }
    logger.info(`Unregistered server ${serverId} from model manager`);
  }

  /**
   * Update model state for a server
   */
  updateModelState(serverId: string, model: string, updates: Partial<ModelLoadingState>): void {
    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      logger.warn(`Cannot update model state: server ${serverId} not registered`);
      return;
    }

    const existing = serverState.models.get(model);
    const updated: ModelLoadingState = {
      ...existing,
      model,
      loaded: updates.loaded ?? existing?.loaded ?? false,
      loading: updates.loading ?? existing?.loading ?? false,
      loadTime: updates.loadTime ?? existing?.loadTime ?? 0,
      lastUsed: updates.lastUsed ?? existing?.lastUsed ?? 0,
      size: updates.size ?? existing?.size ?? 0,
      parameters: updates.parameters ?? existing?.parameters,
      quantization: updates.quantization ?? existing?.quantization,
      gpuMemory: updates.gpuMemory ?? existing?.gpuMemory ?? 0,
      errorCount: updates.errorCount ?? existing?.errorCount ?? 0,
      lastError: updates.lastError ?? existing?.lastError,
      warmupTime: updates.warmupTime ?? existing?.warmupTime,
    };

    serverState.models.set(model, updated);
    serverState.lastUpdated = Date.now();

    // Update job status if this was a warmup
    if (updates.loaded && existing?.loading) {
      this.updateWarmupJobStatus(serverId, model, 'loaded');
    } else if (updates.lastError && existing?.loading) {
      this.updateWarmupJobStatus(serverId, model, 'failed', updates.lastError);
    }
  }

  /**
   * Get model state for a specific server
   */
  getModelState(serverId: string, model: string): ModelLoadingState | undefined {
    const serverState = this.serverStates.get(serverId);
    return serverState?.models.get(model);
  }

  /**
   * Get all model states for a server
   */
  getServerModelStates(serverId: string): Map<string, ModelLoadingState> | undefined {
    return this.serverStates.get(serverId)?.models;
  }

  /**
   * Check if model is loaded on a server
   */
  isModelLoaded(serverId: string, model: string): boolean {
    const state = this.getModelState(serverId, model);
    return state?.loaded ?? false;
  }

  /**
   * Check if model is currently loading on a server
   */
  isModelLoading(serverId: string, model: string): boolean {
    const state = this.getModelState(serverId, model);
    return state?.loading ?? false;
  }

  /**
   * Mark model as used (updates lastUsed timestamp)
   */
  markModelUsed(serverId: string, model: string): void {
    this.updateModelState(serverId, model, { lastUsed: Date.now() });
  }

  /**
   * Get servers with model already loaded
   */
  getServersWithModelLoaded(model: string, serverIds?: string[]): string[] {
    const result: string[] = [];
    const serversToCheck = serverIds ?? Array.from(this.serverStates.keys());

    for (const serverId of serversToCheck) {
      if (this.isModelLoaded(serverId, model)) {
        result.push(serverId);
      }
    }

    return result;
  }

  /**
   * Get servers where model is not loaded
   */
  getServersWithoutModel(model: string, serverIds?: string[]): string[] {
    const result: string[] = [];
    const serversToCheck = serverIds ?? Array.from(this.serverStates.keys());

    for (const serverId of serversToCheck) {
      if (!this.isModelLoaded(serverId, model) && !this.isModelLoading(serverId, model)) {
        result.push(serverId);
      }
    }

    return result;
  }

  /**
   * Get model load time (with estimation if unknown)
   */
  getEstimatedLoadTime(model: string, size?: number): number {
    // Try to get actual load time from any server
    for (const serverState of this.serverStates.values()) {
      const modelState = serverState.models.get(model);
      if (modelState && modelState.loadTime > 0) {
        return modelState.loadTime;
      }
    }

    const loadTimes = this.config.loadTimeEstimates;

    // Estimate based on size
    if (size && size > 0) {
      if (size < 2) {
        return loadTimes.tiny;
      }
      if (size < 5) {
        return loadTimes.small;
      }
      if (size < 10) {
        return loadTimes.medium;
      }
      if (size < 20) {
        return loadTimes.large;
      }
      if (size < 50) {
        return loadTimes.xl;
      }
      return loadTimes.xxl;
    }

    // Try to estimate from model name
    const params = this.extractParametersFromModelName(model);
    if (params) {
      const num = parseFloat(params);
      if (num < 1) {
        return loadTimes.tiny;
      }
      if (num <= 7) {
        return loadTimes.small;
      }
      if (num <= 13) {
        return loadTimes.medium;
      }
      if (num <= 30) {
        return loadTimes.large;
      }
      if (num <= 70) {
        return loadTimes.xl;
      }
      return loadTimes.xxl;
    }

    return loadTimes.medium;
  }

  /**
   * Extract parameter count from model name (e.g., "llama3:8b" -> "8b")
   */
  private extractParametersFromModelName(model: string): string | undefined {
    const match = model.match(/:(\d+[bm])$/i);
    return match?.[1]?.toLowerCase();
  }

  /**
   * Trigger warmup for a model on specified servers
   */
  async warmupModel(
    model: string,
    options: {
      serverIds?: string[];
      priority?: 'low' | 'normal' | 'high';
    } = {}
  ): Promise<WarmupResult> {
    const { serverIds, priority = 'normal' } = options;
    const targetServers = serverIds ?? Array.from(this.serverStates.keys());
    const estimatedTime = this.getEstimatedLoadTime(model);

    const result: WarmupResult = {
      model,
      jobs: [],
      totalServers: targetServers.length,
      loadedOn: 0,
      loadingOn: 0,
      failedOn: 0,
    };

    for (const serverId of targetServers) {
      const serverState = this.serverStates.get(serverId);
      if (!serverState) {
        continue;
      }

      // Fetch model info and pre-populate state
      let serverEstimatedTime = estimatedTime;
      const modelInfo = await this.getModelInfo(serverState.serverUrl, model);
      if (modelInfo.size > 0) {
        // Update estimated time based on actual size
        serverEstimatedTime = this.getEstimatedLoadTime(model, modelInfo.size);

        // Pre-populate model state with info
        this.updateModelState(serverId, model, {
          size: modelInfo.size,
          parameters: modelInfo.parameters,
          quantization: modelInfo.quantization,
        });
      }

      const currentState = serverState.models.get(model);

      // Skip if already loaded
      if (currentState?.loaded) {
        result.jobs.push({
          serverId,
          status: 'loaded',
          estimatedTime: 0,
          loadTime: currentState.loadTime,
        });
        result.loadedOn++;
        continue;
      }

      // Skip if already loading
      if (currentState?.loading) {
        result.jobs.push({
          serverId,
          status: 'loading',
          estimatedTime: serverEstimatedTime,
        });
        result.loadingOn++;
        continue;
      }

      // Create warmup job
      const jobId = `warmup-${++this.jobCounter}`;
      const job: WarmupJob = {
        id: jobId,
        model,
        serverId,
        status: 'pending',
        priority,
        startTime: Date.now(),
        estimatedTime: serverEstimatedTime,
        progress: 0,
      };

      this.warmupJobs.set(jobId, job);

      // Update model state to loading
      this.updateModelState(serverId, model, {
        loading: true,
        loaded: false,
      });

      result.jobs.push({
        serverId,
        status: 'loading',
        estimatedTime: serverEstimatedTime,
      });
      result.loadingOn++;

      // Trigger actual load (fire and forget)
      this.executeWarmup(job).catch(error => {
        logger.error(`Warmup failed for ${model} on ${serverId}:`, error);
      });
    }

    logger.info(`Warmup initiated for ${model} on ${result.loadingOn} servers`);
    return result;
  }

  /**
   * Execute warmup by making a request to load the model with retry logic
   */
  private async executeWarmup(job: WarmupJob): Promise<void> {
    const serverState = this.serverStates.get(job.serverId);
    if (!serverState) {
      job.status = 'failed';
      job.error = ERROR_MESSAGES.SERVER_NOT_FOUND_PLAIN;
      job.endTime = Date.now();
      return;
    }

    job.status = 'loading';
    const startTime = Date.now();

    try {
      // Check if we have enough GPU memory before loading
      const memoryCheck = await this.canLoadModel(job.serverId, job.model);
      if (!memoryCheck.canLoad) {
        throw new Error(`Insufficient GPU memory: ${memoryCheck.reason}`);
      }

      // Execute with retry logic
      await this.executeWarmupWithRetry(job, serverState.serverUrl);

      const loadTime = Date.now() - startTime;

      // Update GPU memory tracking after successful load
      await this.updateGpuMemory(job.serverId);

      // Get the updated model state for GPU memory info
      const modelState = serverState.models.get(job.model);

      this.updateModelState(job.serverId, job.model, {
        loaded: true,
        loading: false,
        loadTime,
        lastUsed: Date.now(),
        warmupTime: Date.now(),
        size: modelState?.size ?? 0,
        gpuMemory: modelState?.gpuMemory ?? 0,
      });

      job.status = 'loaded';
      job.endTime = Date.now();

      logger.info(`Warmup complete for ${job.model} on ${job.serverId} (${loadTime}ms)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      job.status = 'failed';
      job.error = errorMessage;
      job.endTime = Date.now();

      const currentState = serverState.models.get(job.model);
      this.updateModelState(job.serverId, job.model, {
        loaded: false,
        loading: false,
        errorCount: (currentState?.errorCount ?? 0) + 1,
        lastError: errorMessage,
      });

      logger.error(`Warmup failed for ${job.model} on ${job.serverId}: ${errorMessage}`);
    }
  }

  /**
   * Execute warmup with retry logic and timeout handling
   */
  private async executeWarmupWithRetry(
    job: WarmupJob,
    serverUrl: string,
    attempt: number = 1
  ): Promise<void> {
    job.abortController = new AbortController();

    try {
      logger.debug(
        `Warmup attempt ${attempt}/${this.config.maxRetries} for ${job.model} on ${job.serverId}`
      );

      // Make actual request to Ollama server to load the model
      // Use empty prompt with minimal tokens to force model loading without heavy computation
      const response = await fetchWithTimeout(`${serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: job.model,
          prompt: '', // Empty prompt to minimize processing
          stream: false, // Non-streaming for faster response
          options: {
            temperature: 0, // Minimal randomness
            num_predict: 1, // Generate only 1 token
            num_ctx: 2048, // Standard context size
          },
        }),
        timeout: this.config.warmupTimeoutMs,
        signal: job.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error (${response.status}): ${errorText}`);
      }

      // Parse response to verify model loaded successfully
      const data = (await response.json()) as OllamaGenerateResponse;

      // Check if we got a valid response (model is loaded)
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response from Ollama API');
      }

      // Success! Model is now loaded in memory
      logger.debug(`Model ${job.model} successfully loaded on ${job.serverId}`);
    } catch (error) {
      // Check if this is a retryable error
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = this.isRetryableError(errorMessage);

      if (isRetryable && attempt < this.config.maxRetries) {
        // Calculate exponential backoff delay
        const delay = this.config.retryDelayBaseMs * Math.pow(2, attempt - 1);
        logger.warn(
          `Warmup attempt ${attempt} failed for ${job.model}, retrying in ${delay}ms: ${errorMessage}`
        );

        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, delay));

        // Retry
        return this.executeWarmupWithRetry(job, serverUrl, attempt + 1);
      }

      // Non-retryable error or max retries exceeded
      throw error;
    }
  }

  /**
   * Check if an error is retryable using centralized error classifier
   */
  private isRetryableError(errorMessage: string): boolean {
    return getErrorClassifier().isRetryable(errorMessage);
  }

  /**
   * Update warmup job status
   */
  private updateWarmupJobStatus(
    serverId: string,
    model: string,
    status: WarmupJob['status'],
    error?: string
  ): void {
    for (const job of this.warmupJobs.values()) {
      if (job.serverId === serverId && job.model === model && job.status === 'loading') {
        job.status = status;
        job.endTime = Date.now();
        if (error) {
          job.error = error;
        }
        break;
      }
    }
  }

  /**
   * Cancel a warmup job by ID
   */
  cancelWarmup(jobId: string): boolean {
    const job = this.warmupJobs.get(jobId);
    if (!job) {
      return false;
    }

    // Can only cancel pending or loading jobs
    if (job.status !== 'pending' && job.status !== 'loading') {
      return false;
    }

    // Abort the fetch request if in progress
    if (job.abortController) {
      job.abortController.abort();
    }

    job.status = 'cancelled';
    job.endTime = Date.now();
    job.error = 'Cancelled by user';

    // Update model state
    this.updateModelState(job.serverId, job.model, {
      loaded: false,
      loading: false,
    });

    logger.info(`Warmup job ${jobId} for ${job.model} on ${job.serverId} cancelled`);
    return true;
  }

  /**
   * Cancel all warmup jobs for a specific model
   */
  cancelModelWarmup(model: string): number {
    let cancelled = 0;

    for (const [jobId, job] of this.warmupJobs.entries()) {
      if (job.model === model && (job.status === 'pending' || job.status === 'loading')) {
        if (this.cancelWarmup(jobId)) {
          cancelled++;
        }
      }
    }

    return cancelled;
  }

  /**
   * Fetch model information from Ollama server
   */
  async getModelInfo(
    serverUrl: string,
    model: string
  ): Promise<{
    size: number; // Size in GB
    parameters?: string;
    quantization?: string;
    family?: string;
  }> {
    try {
      const response = await fetchWithTimeout(`${serverUrl}/api/show`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        timeout: 30000, // 30 second timeout
      });

      if (!response.ok) {
        logger.warn(`Failed to get model info for ${model}: ${response.statusText}`);
        return { size: 0 };
      }

      const data = (await response.json()) as OllamaShowResponse;

      return {
        size: this.parseModelSize(data),
        parameters: data.details?.parameter_size,
        quantization: data.details?.quantization_level,
        family: data.details?.family,
      };
    } catch (error) {
      logger.warn(`Error fetching model info for ${model}:`, error);
      return { size: 0 };
    }
  }

  /**
   * Parse model size from API response
   */
  private parseModelSize(data: OllamaShowResponse): number {
    // Try to get size from model info
    if (data.size) {
      return data.size / (1024 * 1024 * 1024); // Convert bytes to GB
    }

    // Estimate from parameters
    const params = data.details?.parameter_size;
    if (params) {
      const num = parseFloat(params);
      if (!isNaN(num)) {
        // Rough estimate: use configurable GB per billion parameters
        return num * this.config.gbPerBillionParams;
      }
    }

    return 0;
  }

  /**
   * Update GPU memory tracking for a server
   */
  async updateGpuMemory(serverId: string): Promise<void> {
    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      return;
    }

    try {
      // Check running models via /api/ps
      const response = await fetchWithTimeout(`${serverState.serverUrl}/api/ps`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000, // 10 second timeout
      });

      if (!response.ok) {
        logger.debug(`Failed to get process list from ${serverId}: ${response.statusText}`);
        return;
      }

      const data = (await response.json()) as OllamaProcessListResponse;
      let totalUsed = 0;

      for (const process of data.models ?? []) {
        const modelName = process.model ?? process.name;
        const modelState = modelName ? serverState.models.get(modelName) : undefined;

        if (modelState) {
          // Update GPU memory for each loaded model
          // size_vram is in bytes, convert to MB
          const vram = process.size_vram ?? process.vram ?? 0;
          modelState.gpuMemory = Math.round(vram / (1024 * 1024));
          totalUsed += modelState.gpuMemory;

          // Mark as loaded if it's in the process list
          if (!modelState.loaded) {
            modelState.loaded = true;
            modelState.loading = false;
          }
        }
      }

      serverState.loadedModelsMemory = totalUsed;
      // Estimate available memory (if we don't know total, assume 80% of loaded is in use)
      if (serverState.totalGpuMemory === 0) {
        serverState.totalGpuMemory = Math.round(totalUsed * 1.25); // Estimate total as 125% of used
      }
      serverState.availableGpuMemory = Math.max(0, serverState.totalGpuMemory - totalUsed);
      serverState.lastUpdated = Date.now();

      logger.debug(
        `GPU memory updated for ${serverId}: ${totalUsed}MB used, ${serverState.availableGpuMemory}MB available`
      );
    } catch (error) {
      logger.debug(`Error updating GPU memory for ${serverId}:`, error);
    }
  }

  /**
   * Check if server has enough GPU memory to load a model
   */
  async canLoadModel(
    serverId: string,
    model: string
  ): Promise<{ canLoad: boolean; reason?: string }> {
    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      return { canLoad: false, reason: ERROR_MESSAGES.SERVER_NOT_FOUND_PLAIN };
    }

    // Update current GPU memory state
    await this.updateGpuMemory(serverId);

    // Get model info
    const modelInfo = await this.getModelInfo(serverState.serverUrl, model);
    const estimatedMemory = modelInfo.size * 1024; // Convert GB to MB

    // If we can't determine size, allow it but log a warning
    if (estimatedMemory === 0) {
      logger.warn(`Cannot estimate memory for ${model}, allowing warmup without memory check`);
      return { canLoad: true };
    }

    // Apply safety margin from config
    const safetyMarginPercent = Math.round((this.config.memorySafetyMargin - 1) * 100);
    const requiredMemory = estimatedMemory * this.config.memorySafetyMargin;

    if (serverState.availableGpuMemory < requiredMemory) {
      return {
        canLoad: false,
        reason: `Insufficient GPU memory. Required: ${Math.round(requiredMemory)}MB (${Math.round(estimatedMemory)}MB + ${safetyMarginPercent}% buffer), Available: ${Math.round(serverState.availableGpuMemory)}MB`,
      };
    }

    return { canLoad: true };
  }

  /**
   * Get status of a warmup job
   */
  getWarmupJob(jobId: string): WarmupJob | undefined {
    return this.warmupJobs.get(jobId);
  }

  /**
   * Get all pending warmup jobs
   */
  getPendingWarmupJobs(): WarmupJob[] {
    return Array.from(this.warmupJobs.values()).filter(
      job => job.status === 'pending' || job.status === 'loading'
    );
  }

  /**
   * Get warmup status for a model across all servers
   */
  getModelWarmupStatus(model: string): {
    totalServers: number;
    loadedOn: number;
    loadingOn: number;
    notLoadedOn: number;
    failedOn: number;
    servers: Record<
      string,
      {
        loaded: boolean;
        loading: boolean;
        lastUsed?: number;
        loadTime?: number;
        gpuMemory?: number;
      }
    >;
  } {
    const servers = new Map<string, ServerWarmupStatusEntry>();
    let loadedOn = 0;
    let loadingOn = 0;
    let notLoadedOn = 0;
    let failedOn = 0;

    for (const [serverId, serverState] of this.serverStates.entries()) {
      const state = serverState.models.get(model);

      if (state) {
        servers.set(serverId, {
          loaded: state.loaded,
          loading: state.loading,
          lastUsed: state.lastUsed,
          loadTime: state.loadTime,
          gpuMemory: state.gpuMemory,
        });

        if (state.loaded) {
          loadedOn++;
        } else if (state.loading) {
          loadingOn++;
        } else if (state.errorCount > 0) {
          failedOn++;
        } else {
          notLoadedOn++;
        }
      } else {
        servers.set(serverId, {
          loaded: false,
          loading: false,
        });
        notLoadedOn++;
      }
    }

    return {
      totalServers: this.serverStates.size,
      loadedOn,
      loadingOn,
      notLoadedOn,
      failedOn,
      servers: Object.fromEntries(servers),
    };
  }

  /**
   * Get all models that should be warmed up based on usage patterns
   */
  getRecommendedWarmupModels(minRequests = 10, timeWindow = 3600000): string[] {
    const modelUsage: Map<string, { requests: number; lastUsed: number }> = new Map();

    // Collect usage stats
    for (const serverState of this.serverStates.values()) {
      for (const [model, state] of serverState.models.entries()) {
        const existing = modelUsage.get(model);
        if (existing) {
          existing.requests++;
          existing.lastUsed = Math.max(existing.lastUsed, state.lastUsed);
        } else {
          modelUsage.set(model, {
            requests: 1,
            lastUsed: state.lastUsed,
          });
        }
      }
    }

    // Filter by criteria
    const now = Date.now();
    const recommended: string[] = [];

    for (const [model, usage] of modelUsage.entries()) {
      if (usage.requests >= minRequests && now - usage.lastUsed < timeWindow) {
        recommended.push(model);
      }
    }

    return recommended.sort((a, b) => {
      const usageA = modelUsage.get(a)!;
      const usageB = modelUsage.get(b)!;
      return usageB.requests - usageA.requests;
    });
  }

  /**
   * Unload a model from a server (free up memory)
   * Actually calls Ollama API to unload the model from memory
   */
  async unloadModel(serverId: string, model: string): Promise<boolean> {
    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      return false;
    }

    const state = serverState.models.get(model);
    if (!state?.loaded) {
      return false;
    }

    try {
      // Call Ollama API to actually unload the model
      // Using generate endpoint with keep_alive: 0 forces immediate unload
      const response = await fetchWithTimeout(`${serverState.serverUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: '', // Empty prompt
          stream: false,
          options: {
            temperature: 0,
            num_predict: 1,
          },
          keep_alive: 0, // Unload immediately after request
        }),
        timeout: 30000, // 30 second timeout
      });

      if (!response.ok) {
        logger.warn(
          `Failed to unload model ${model} from server ${serverId}: ${response.statusText}`
        );
        return false;
      }

      // Update state to not loaded
      state.loaded = false;
      state.loading = false;
      state.lastUsed = 0;
      state.gpuMemory = 0;

      serverState.models.set(model, state);
      serverState.lastUpdated = Date.now();

      logger.info(`Unloaded model ${model} from server ${serverId}`);
      return true;
    } catch (error) {
      logger.error(`Error unloading model ${model} from server ${serverId}:`, error);
      return false;
    }
  }

  /**
   * Get idle models (not used for a while) that can be unloaded
   */
  getIdleModels(
    idleThreshold?: number
  ): Array<{ serverId: string; model: string; idleTime: number }> {
    const threshold = idleThreshold ?? this.config.idleThresholdMs;
    const now = Date.now();
    const idle: Array<{ serverId: string; model: string; idleTime: number }> = [];

    for (const [serverId, serverState] of this.serverStates.entries()) {
      for (const [model, state] of serverState.models.entries()) {
        if (state.loaded && state.lastUsed > 0) {
          const idleTime = now - state.lastUsed;
          if (idleTime > threshold) {
            idle.push({ serverId, model, idleTime });
          }
        }
      }
    }

    return idle.sort((a, b) => b.idleTime - a.idleTime);
  }

  /**
   * Get summary of all managed models
   */
  getSummary(): {
    totalServers: number;
    totalModels: number;
    loadedModels: number;
    loadingModels: number;
    averageLoadTime: number;
  } {
    let loadedModels = 0;
    let loadingModels = 0;
    let totalLoadTime = 0;
    let loadTimeCount = 0;

    const seenModels = new Set<string>();

    for (const serverState of this.serverStates.values()) {
      for (const [model, state] of serverState.models.entries()) {
        seenModels.add(model);

        if (state.loaded) {
          loadedModels++;
        }
        if (state.loading) {
          loadingModels++;
        }

        if (state.loadTime > 0) {
          totalLoadTime += state.loadTime;
          loadTimeCount++;
        }
      }
    }

    return {
      totalServers: this.serverStates.size,
      totalModels: seenModels.size,
      loadedModels,
      loadingModels,
      averageLoadTime: loadTimeCount > 0 ? Math.round(totalLoadTime / loadTimeCount) : 0,
    };
  }

  /**
   * Warmup multiple models with concurrency control
   */
  async warmupMultiple(
    models: string[],
    options: {
      serverIds?: string[];
      priority?: 'low' | 'normal' | 'high';
      concurrency?: number; // Max concurrent warmups per model
    } = {}
  ): Promise<WarmupResult[]> {
    const { concurrency = 3 } = options;
    const results: WarmupResult[] = [];

    logger.info(`Starting batch warmup for ${models.length} models (concurrency: ${concurrency})`);

    // Process models in parallel with concurrency limit
    const executing: Promise<void>[] = [];
    let index = 0;

    const processNext = async (): Promise<void> => {
      if (index >= models.length) {
        return;
      }

      const model = models[index++];
      try {
        const result = await this.warmupModel(model, options);
        results.push(result);
      } catch (error) {
        logger.error(`Batch warmup failed for ${model}:`, error);
        // Push a failed result
        results.push({
          model,
          jobs: [],
          totalServers: 0,
          loadedOn: 0,
          loadingOn: 0,
          failedOn: 0,
        });
      }

      // Process next model
      await processNext();
    };

    // Start initial batch of concurrent warmups
    for (let i = 0; i < Math.min(concurrency, models.length); i++) {
      executing.push(processNext());
    }

    // Wait for all to complete
    await Promise.all(executing);

    logger.info(`Batch warmup complete: ${results.length} models processed`);
    return results;
  }

  /**
   * Get optimal warmup order based on available GPU memory
   * Smaller models first to maximize GPU utilization
   */
  async getOptimalWarmupOrder(models: string[], serverId: string): Promise<string[]> {
    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      return models;
    }

    // Get size for each model
    const modelsWithSize: Array<{ model: string; size: number }> = [];

    for (const model of models) {
      // Check if we already have size info
      const existingState = serverState.models.get(model);
      if (existingState?.size && existingState.size > 0) {
        modelsWithSize.push({ model, size: existingState.size });
      } else {
        // Fetch model info to get size
        const info = await this.getModelInfo(serverState.serverUrl, model);
        modelsWithSize.push({ model, size: info.size || this.estimateModelSize(model) });
      }
    }

    // Sort by size (smallest first)
    modelsWithSize.sort((a, b) => a.size - b.size);

    return modelsWithSize.map(m => m.model);
  }

  /**
   * Estimate model size from name when info is not available
   */
  private estimateModelSize(model: string): number {
    const params = this.extractParametersFromModelName(model);
    if (params) {
      const num = parseFloat(params);
      if (!isNaN(num)) {
        // Use configurable GB per billion parameters
        return num * this.config.gbPerBillionParams;
      }
    }

    return this.config.defaultModelSizeGb; // Default size if unknown
  }

  /**
   * Preload models based on recommendations and available memory
   */
  async preloadRecommendedModels(
    serverId: string,
    options: {
      maxModels?: number;
      maxMemoryGB?: number;
      minRequests?: number;
    } = {}
  ): Promise<WarmupResult[]> {
    const { maxModels = 5, maxMemoryGB = 0, minRequests = 5 } = options;

    const serverState = this.serverStates.get(serverId);
    if (!serverState) {
      throw new Error(ERROR_MESSAGES.SERVER_NOT_FOUND_COLON(serverId));
    }

    // Get recommended models
    const recommended = this.getRecommendedWarmupModels(minRequests);

    // Get optimal order
    const ordered = await this.getOptimalWarmupOrder(recommended, serverId);

    // Limit to max models
    let toWarmup = ordered.slice(0, maxModels);

    // If max memory specified, filter by memory availability
    if (maxMemoryGB > 0) {
      let usedMemory = serverState.loadedModelsMemory / 1024; // Convert MB to GB
      const withinBudget: string[] = [];

      for (const model of toWarmup) {
        const info = await this.getModelInfo(serverState.serverUrl, model);
        if (usedMemory + info.size <= maxMemoryGB) {
          withinBudget.push(model);
          usedMemory += info.size;
        }
      }

      toWarmup = withinBudget;
    }

    if (toWarmup.length === 0) {
      logger.info(`No models to preload for ${serverId}`);
      return [];
    }

    logger.info(`Preloading ${toWarmup.length} models on ${serverId}`);

    // Warmup all recommended models
    return this.warmupMultiple(toWarmup, {
      serverIds: [serverId],
      priority: 'low', // Low priority since this is background preloading
      concurrency: 2,
    });
  }

  /**
   * Reset all state (for testing)
   */
  reset(): void {
    this.serverStates.clear();
    this.warmupJobs.clear();
    this.jobCounter = 0;
    logger.info('Model manager reset');
  }
}
