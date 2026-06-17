/**
 * probe-scheduler.ts
 * Periodic capability probe scheduler using negative probing.
 *
 * Detects capability drift over time by periodically probing servers with
 * invalid model names and checking for:
 * - modelNotFound: server has model but not this one
 * - endpointAbsent: server doesn't support this endpoint (soft-revoke immediately)
 * - midStreamError: server validates mid-stream
 * - suspicious: 200 on invalid model (no validation)
 *
 * Integrates with EndpointRegistry.softRevoke() for capability revocation.
 */

import { type ConfigManager } from '../config/config.js';
import type { CapabilityProbeConfig } from '../config/schema.js';
import type { NegativeProbeResult } from '../orchestrator/probe-executor-negative.js';
import { probeExecutorNegative, type Endpoint } from '../orchestrator/probe-executor-negative.js';
import { logger } from '../utils/logger.js';

import type { EndpointRegistry } from './endpoint-registry.js';
import type { ProbeEndpoint } from './types.js';

/**
 * All 11 endpoints probed by the capability scheduler (for negative probing).
 * 7 inference + 4 admin/listing.
 */
const ALL_PROBE_ENDPOINTS: Endpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
  'ollama_tags',
  'ollama_ps',
  'ollama_version',
  'openai_models',
];

/**
 * The 7 endpoints tracked by EndpointRegistry (inference endpoints only).
 */
const REGISTRY_TRACKED_ENDPOINTS: ProbeEndpoint[] = [
  'ollama_chat',
  'ollama_generate',
  'ollama_embeddings',
  'openai_chat',
  'openai_completions',
  'openai_embeddings',
  'anthropic_messages',
];

/**
 * Minimal server descriptor for capability probing.
 */
export interface ServerDescriptor {
  id: string;
  url: string;
  apiKey?: string;
}

/**
 * Result of a single capability probe cycle.
 */
export interface CycleResult {
  serverId: string;
  confirmed: number;
  revoked: number;
  rateLimited: boolean;
  errors: string[];
}

/**
 * CapabilityProbeScheduler options.
 */
export interface CapabilityProbeSchedulerOptions {
  endpointRegistry: EndpointRegistry;
  configManager: ConfigManager;
  logger: typeof logger;
  serverListProvider: () => Promise<ServerDescriptor[]>;
  probeExecutor?: typeof probeExecutorNegative;
}

/**
 * Periodic scheduler that runs negative probes against all servers
 * to detect capability drift over time.
 */
export class CapabilityProbeScheduler {
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;
  private deferredServers = new Map<string, number>(); // serverId -> deferredUntil timestamp

  constructor(private opts: CapabilityProbeSchedulerOptions) {}

  /**
   * Get capability probe config with defaults if not present.
   */
  private getConfig(): CapabilityProbeConfig {
    const config = this.opts.configManager.getConfig();
    return (
      config.capabilityProbe ?? {
        enabled: true,
        intervalMs: 300000,
        consecutiveFailureThreshold: 3,
        requestTimeoutMs: 5000,
        staggerOffsetMs: 30000,
      }
    );
  }

  /**
   * Start the periodic capability probe schedule.
   */
  start(): void {
    if (this.running) {
      return;
    }

    const config = this.getConfig();
    if (!config.enabled) {
      this.opts.logger.info('capability-probe scheduler disabled in config');
      return;
    }

    this.running = true;
    this.intervalHandle = setInterval(() => {
      this.tick().catch(err => {
        this.opts.logger.error('capability-probe tick error', { error: String(err) });
      });
    }, config.intervalMs);

    // Allow clean exit without keeping process alive
    if (this.intervalHandle.unref) {
      this.intervalHandle.unref();
    }

    this.opts.logger.info('capability-probe scheduler started', {
      intervalMs: config.intervalMs,
      staggerOffsetMs: config.staggerOffsetMs,
    });
  }

  /**
   * Stop the periodic schedule.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    this.deferredServers.clear();
    this.opts.logger.info('capability-probe scheduler stopped');
  }

  /**
   * Run a single capability probe cycle.
   * Optionally scoped to a single serverId.
   */
  async runOnce(serverId?: string): Promise<CycleResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      return {
        serverId: serverId ?? 'all',
        confirmed: 0,
        revoked: 0,
        rateLimited: false,
        errors: [],
      };
    }

    const servers = await this.opts.serverListProvider();
    const filteredServers = serverId ? servers.filter(s => s.id === serverId) : servers;

    let totalConfirmed = 0;
    let totalRevoked = 0;
    let rateLimited = false;
    const errors: string[] = [];

    for (const server of filteredServers) {
      // Check if this server is deferred due to 429
      const deferredUntil = this.deferredServers.get(server.id);
      if (deferredUntil !== undefined && Date.now() < deferredUntil) {
        continue;
      }

      // Clear any expired deferral
      if (deferredUntil !== undefined) {
        this.deferredServers.delete(server.id);
      }

      this.opts.logger.info('capability-probe cycle started', { serverId: server.id });

      let serverConfirmed = 0;
      let serverRevoked = 0;

      for (const endpoint of ALL_PROBE_ENDPOINTS) {
        try {
          const result = await this.executeProbe(server, endpoint, config);

          // Only registry-tracked endpoints get registry updates
          const isTracked = REGISTRY_TRACKED_ENDPOINTS.includes(endpoint as ProbeEndpoint);

          if (result.endpointAbsent) {
            if (isTracked) {
              this.opts.endpointRegistry.softRevoke(server.id, endpoint as ProbeEndpoint);
              serverRevoked++;
              this.opts.logger.info('capability auto-revoked', {
                serverId: server.id,
                endpoint,
                reason: 'endpoint_absent',
              });
            }
          } else if (result.modelNotFound || result.midStreamError) {
            if (isTracked) {
              this.opts.endpointRegistry.recordFailure(
                server.id,
                endpoint as ProbeEndpoint,
                config.consecutiveFailureThreshold
              );
              const failures = this.opts.endpointRegistry.getConsecutiveFailures(
                server.id,
                endpoint as ProbeEndpoint
              );
              if (failures >= config.consecutiveFailureThreshold) {
                serverRevoked++;
                this.opts.logger.info('capability auto-revoked', {
                  serverId: server.id,
                  endpoint,
                  reason: 'consecutive_failures',
                  failures,
                });
              }
            }
          } else if (result.suspicious) {
            this.opts.logger.warn('server returned 200 on invalid model — no validation', {
              serverId: server.id,
              endpoint,
            });
          } else if (result.capabilityConfirmed || result.success) {
            if (isTracked) {
              this.opts.endpointRegistry.confirm(server.id, endpoint as ProbeEndpoint);
              serverConfirmed++;
            }
          }

          // Handle 429 — defer next probe for this server
          if (result.status === 429) {
            const retryAfterMs = result.retryAfterMs ?? config.intervalMs;
            this.deferredServers.set(server.id, Date.now() + retryAfterMs);
            rateLimited = true;
            this.opts.logger.warn('capability-probe rate limited, deferring', {
              serverId: server.id,
              retryAfterMs,
            });
            break;
          }
        } catch (err) {
          errors.push(`${server.id}:${endpoint}: ${String(err)}`);
        }
      }

      totalConfirmed += serverConfirmed;
      totalRevoked += serverRevoked;

      this.opts.logger.info('capability-probe cycle complete', {
        serverId: server.id,
        confirmed: serverConfirmed,
        revoked: serverRevoked,
        rateLimited,
      });
    }

    return {
      serverId: serverId ?? 'all',
      confirmed: totalConfirmed,
      revoked: totalRevoked,
      rateLimited,
      errors,
    };
  }

  /**
   * Execute a single negative probe against a server:endpoint.
   */
  private async executeProbe(
    server: ServerDescriptor,
    endpoint: Endpoint,
    config: CapabilityProbeConfig
  ): Promise<NegativeProbeResult> {
    const executor = this.opts.probeExecutor ?? probeExecutorNegative;
    return executor(
      { serverId: server.id, model: '__capability_probe__', endpoint },
      {
        serverUrl: server.url,
        apiKey: server.apiKey,
        timeoutMs: config.requestTimeoutMs,
      }
    );
  }

  /**
   * Internal tick — called by setInterval.
   */
  private async tick(): Promise<void> {
    await this.runOnce();
  }
}
