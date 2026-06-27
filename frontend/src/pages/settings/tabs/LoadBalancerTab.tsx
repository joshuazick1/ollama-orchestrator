import { memo } from 'react';
import { Activity } from 'lucide-react';
import type { OrchestratorConfig } from '../../../api';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';

interface LoadBalancerTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const LoadBalancerTab = memo<LoadBalancerTabProps>(({ config, onUpdateField }) => {
  const lb = config.loadBalancer || {
    weights: {
      latency: 0.17,
      successRate: 0.17,
      load: 0.17,
      capacity: 0.05,
      circuitBreaker: 0.12,
      timeout: 0.05,
      throughput: 0.07,
      vram: 0.05,
      temporal: 0.1,
      context: 0.05,
      itl: 0,
      cacheHit: 0,
      promptSize: 0,
      errorType: 0,
    },
    thresholds: {
      maxP95Latency: 5000,
      minSuccessRate: 0.95,
      latencyPenalty: 0.5,
      errorPenalty: 0.3,
      circuitBreakerPenalty: 0.1,
    },
    latencyBlendRecent: 0.6,
    latencyBlendHistorical: 0.4,
    loadFactorMultiplier: 0.5,
    defaultLatencyMs: 1000,
    defaultMaxConcurrency: 4,
    streaming: {
      ttftWeight: 0.6,
      durationWeight: 0.4,
      ttftBlendAvg: 0.5,
      ttftBlendP95: 0.5,
      durationEstimateMultiplier: 2,
      chunkWeight: 0.2,
      maxChunkGapPenaltyMs: 5000,
      stallThresholdMs: 300000,
      stallCheckIntervalMs: 10000,
      maxHandoffAttempts: 2,
    },
    roundRobin: {
      skipUnhealthy: true,
      checkCapacity: true,
      stickySessionsTtlMs: 0,
      maxStickySessions: 10000,
    },
    leastConnections: {
      skipUnhealthy: true,
      considerCapacity: true,
      considerFailureRate: true,
      failureRatePenalty: 2.0,
    },
    crossModelInference: {
      enabled: true,
      useParameterSize: true,
      minSamplesForExact: 5,
      fallbackWeight: 0.5,
    },
    fallbackToFastestResponse: false,
    prefixCacheAware: {
      enabled: false,
      hashTokenCount: 512,
      hashBuckets: 256,
    },
    sloFallback: {
      enabled: false,
      ttftThresholdMs: 2000,
      p95WindowMs: 60000,
    },
    ghostServers: {
      staleThresholdMs: 300000,
      removeOnCleanup: false,
    },
    tokenWeightedLoad: {
      enabled: true,
      promptTokenWeight: 1.0,
      outputTokenWeight: 4.0,
    },
    coldStartMagnitude: {
      enabled: true,
      thresholdMs: 1000,
      penaltyDurationMs: 60000,
    },
  };

  return (
    <ConfigSection
      title="Load Balancer"
      icon={Activity}
      description="Traffic distribution and scoring settings"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Algorithm Weights</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Latency Weight"
              value={(lb.weights?.latency ?? 0.17) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  latency: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for response time"
            />
            <NumberInput
              label="Success Rate Weight"
              value={(lb.weights?.successRate ?? 0.17) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  successRate: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for reliability"
            />
            <NumberInput
              label="Load Weight"
              value={(lb.weights?.load ?? 0.17) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  load: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for current load"
            />
            <NumberInput
              label="Capacity Weight"
              value={(lb.weights?.capacity ?? 0.05) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  capacity: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for remaining capacity"
            />
            <NumberInput
              label="Circuit Breaker Weight"
              value={(lb.weights?.circuitBreaker ?? 0.12) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  circuitBreaker: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for circuit breaker state"
            />
            <NumberInput
              label="Timeout Weight"
              value={(lb.weights?.timeout ?? 0.05) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  timeout: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for timeout characteristics"
            />
            <NumberInput
              label="Throughput Weight"
              value={(lb.weights?.throughput ?? 0.07) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  throughput: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for throughput"
            />
            <NumberInput
              label="VRAM Weight"
              value={(lb.weights?.vram ?? 0.05) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  vram: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for VRAM availability"
            />
            <NumberInput
              label="Temporal Weight"
              value={(lb.weights?.temporal ?? 0.1) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  temporal: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for temporal patterns"
            />
            <NumberInput
              label="Context Weight"
              value={(lb.weights?.context ?? 0.05) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'weights', {
                  ...lb.weights,
                  context: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Weight for context availability"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Thresholds</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Max P95 Latency"
              value={lb.thresholds?.maxP95Latency ?? 5000}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  maxP95Latency: value,
                })
              }
              min={100}
              step={100}
              suffix="ms"
              description="Maximum acceptable P95 latency"
            />
            <NumberInput
              label="Min Success Rate"
              value={(lb.thresholds?.minSuccessRate ?? 0.95) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  minSuccessRate: value / 100,
                })
              }
              min={0}
              max={100}
              step={1}
              suffix="%"
              description="Minimum acceptable success rate"
            />
            <NumberInput
              label="Latency Penalty"
              value={(lb.thresholds?.latencyPenalty ?? 0.5) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  latencyPenalty: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Score multiplier for high latency"
            />
            <NumberInput
              label="Error Penalty"
              value={(lb.thresholds?.errorPenalty ?? 0.3) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  errorPenalty: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Score multiplier for errors"
            />
            <NumberInput
              label="Circuit Breaker Penalty"
              value={(lb.thresholds?.circuitBreakerPenalty ?? 0.1) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'thresholds', {
                  ...lb.thresholds,
                  circuitBreakerPenalty: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Score multiplier for circuit breaker state"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Latency Blending</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Recent Latency Weight"
              value={(lb.latencyBlendRecent ?? 0.6) * 100}
              onChange={value => onUpdateField('loadBalancer', 'latencyBlendRecent', value / 100)}
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for recent response time"
            />
            <NumberInput
              label="Historical Latency Weight"
              value={(lb.latencyBlendHistorical ?? 0.4) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'latencyBlendHistorical', value / 100)
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for P95 latency"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Load Factor</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="Load Factor Multiplier"
              value={(lb.loadFactorMultiplier ?? 0.5) * 100}
              onChange={value => onUpdateField('loadBalancer', 'loadFactorMultiplier', value / 100)}
              min={0}
              max={200}
              step={5}
              suffix="%"
              description="How load affects effective latency"
            />
            <NumberInput
              label="Default Latency"
              value={lb.defaultLatencyMs ?? 1000}
              onChange={value => onUpdateField('loadBalancer', 'defaultLatencyMs', value)}
              min={100}
              step={100}
              suffix="ms"
              description="Default when no data available"
            />
            <NumberInput
              label="Default Max Concurrency"
              value={lb.defaultMaxConcurrency ?? 4}
              onChange={value => onUpdateField('loadBalancer', 'defaultMaxConcurrency', value)}
              min={1}
              max={100}
              description="Default max concurrency"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Streaming</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <NumberInput
              label="TTFT Weight"
              value={(lb.streaming?.ttftWeight ?? 0.6) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  ttftWeight: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for time-to-first-token"
            />
            <NumberInput
              label="Duration Weight"
              value={(lb.streaming?.durationWeight ?? 0.4) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  durationWeight: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for total duration"
            />
            <NumberInput
              label="TTFT Blend Avg"
              value={(lb.streaming?.ttftBlendAvg ?? 0.5) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  ttftBlendAvg: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for avgTTFT vs P95 TTFT"
            />
            <NumberInput
              label="Duration Estimate Multiplier"
              value={lb.streaming?.durationEstimateMultiplier ?? 2}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  durationEstimateMultiplier: value,
                })
              }
              min={1}
              max={10}
              step={0.5}
              description="Estimate duration as baseLatency * this"
            />
            <NumberInput
              label="Chunk Weight"
              value={(lb.streaming?.chunkWeight ?? 0.2) * 100}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  chunkWeight: value / 100,
                })
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Weight for chunk throughput"
            />
            <NumberInput
              label="Max Handoff Attempts"
              value={lb.streaming?.maxHandoffAttempts ?? 2}
              onChange={value =>
                onUpdateField('loadBalancer', 'streaming', {
                  ...lb.streaming,
                  maxHandoffAttempts: value,
                })
              }
              min={0}
              max={5}
              description="Max failover attempts before giving up"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Round Robin</h4>
          <div className="space-y-4">
            <Toggle
              label="Skip Unhealthy"
              checked={lb.roundRobin?.skipUnhealthy ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'roundRobin', {
                  ...lb.roundRobin,
                  skipUnhealthy: value,
                })
              }
              description="Skip unhealthy servers in round-robin"
            />
            <Toggle
              label="Check Capacity"
              checked={lb.roundRobin?.checkCapacity ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'roundRobin', {
                  ...lb.roundRobin,
                  checkCapacity: value,
                })
              }
              description="Skip servers at capacity"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Sticky Sessions TTL"
                value={lb.roundRobin?.stickySessionsTtlMs ?? 0}
                onChange={value =>
                  onUpdateField('loadBalancer', 'roundRobin', {
                    ...lb.roundRobin,
                    stickySessionsTtlMs: value,
                  })
                }
                min={0}
                step={1000}
                suffix="ms"
                description="TTL for sticky sessions (0 to disable)"
              />
              <NumberInput
                label="Max Sticky Sessions"
                value={lb.roundRobin?.maxStickySessions ?? 10000}
                onChange={value =>
                  onUpdateField('loadBalancer', 'roundRobin', {
                    ...lb.roundRobin,
                    maxStickySessions: value,
                  })
                }
                min={1}
                description="LRU cap for sticky sessions"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Least Connections</h4>
          <div className="space-y-4">
            <Toggle
              label="Skip Unhealthy"
              checked={lb.leastConnections?.skipUnhealthy ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'leastConnections', {
                  ...lb.leastConnections,
                  skipUnhealthy: value,
                })
              }
              description="Skip unhealthy servers"
            />
            <Toggle
              label="Consider Capacity"
              checked={lb.leastConnections?.considerCapacity ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'leastConnections', {
                  ...lb.leastConnections,
                  considerCapacity: value,
                })
              }
              description="Factor in max capacity"
            />
            <Toggle
              label="Consider Failure Rate"
              checked={lb.leastConnections?.considerFailureRate ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'leastConnections', {
                  ...lb.leastConnections,
                  considerFailureRate: value,
                })
              }
              description="Factor in recent failure rate"
            />
            <NumberInput
              label="Failure Rate Penalty"
              value={lb.leastConnections?.failureRatePenalty ?? 2.0}
              onChange={value =>
                onUpdateField('loadBalancer', 'leastConnections', {
                  ...lb.leastConnections,
                  failureRatePenalty: value,
                })
              }
              min={0}
              max={10}
              step={0.5}
              description="Multiplier for failure rate penalty"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Cross Model Inference</h4>
          <div className="space-y-4">
            <Toggle
              label="Enabled"
              checked={lb.crossModelInference?.enabled ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'crossModelInference', {
                  ...lb.crossModelInference,
                  enabled: value,
                })
              }
              description="Enable cross-model inference"
            />
            <Toggle
              label="Use Parameter Size"
              checked={lb.crossModelInference?.useParameterSize ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'crossModelInference', {
                  ...lb.crossModelInference,
                  useParameterSize: value,
                })
              }
              description="Use same parameter size models"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Min Samples For Exact"
                value={lb.crossModelInference?.minSamplesForExact ?? 5}
                onChange={value =>
                  onUpdateField('loadBalancer', 'crossModelInference', {
                    ...lb.crossModelInference,
                    minSamplesForExact: value,
                  })
                }
                min={1}
                description="Min samples before preferring exact"
              />
              <NumberInput
                label="Fallback Weight"
                value={(lb.crossModelInference?.fallbackWeight ?? 0.5) * 100}
                onChange={value =>
                  onUpdateField('loadBalancer', 'crossModelInference', {
                    ...lb.crossModelInference,
                    fallbackWeight: value / 100,
                  })
                }
                min={0}
                max={100}
                step={5}
                suffix="%"
                description="How much to trust inferred vs actual"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Kill Switch</h4>
          <Toggle
            label="Fallback To Fastest Response"
            checked={lb.fallbackToFastestResponse ?? false}
            onChange={value => onUpdateField('loadBalancer', 'fallbackToFastestResponse', value)}
            description="Revert all algorithms to fastest-response behavior"
          />
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Prefix Cache Aware</h4>
          <div className="space-y-4">
            <Toggle
              label="Enabled"
              checked={lb.prefixCacheAware?.enabled ?? false}
              onChange={value =>
                onUpdateField('loadBalancer', 'prefixCacheAware', {
                  ...lb.prefixCacheAware,
                  enabled: value,
                })
              }
              description="Enable prefix-cache-aware routing"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Hash Token Count"
                value={lb.prefixCacheAware?.hashTokenCount ?? 512}
                onChange={value =>
                  onUpdateField('loadBalancer', 'prefixCacheAware', {
                    ...lb.prefixCacheAware,
                    hashTokenCount: value,
                  })
                }
                min={1}
                description="Number of leading tokens to hash"
              />
              <NumberInput
                label="Hash Buckets"
                value={lb.prefixCacheAware?.hashBuckets ?? 256}
                onChange={value =>
                  onUpdateField('loadBalancer', 'prefixCacheAware', {
                    ...lb.prefixCacheAware,
                    hashBuckets: value,
                  })
                }
                min={1}
                description="Number of buckets in hash ring"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">SLO Fallback</h4>
          <div className="space-y-4">
            <Toggle
              label="Enabled"
              checked={lb.sloFallback?.enabled ?? false}
              onChange={value =>
                onUpdateField('loadBalancer', 'sloFallback', {
                  ...lb.sloFallback,
                  enabled: value,
                })
              }
              description="Enable SLO fallback mode"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="TTFT Threshold"
                value={lb.sloFallback?.ttftThresholdMs ?? 2000}
                onChange={value =>
                  onUpdateField('loadBalancer', 'sloFallback', {
                    ...lb.sloFallback,
                    ttftThresholdMs: value,
                  })
                }
                min={100}
                step={100}
                suffix="ms"
                description="TTFT P95 threshold"
              />
              <NumberInput
                label="P95 Window"
                value={lb.sloFallback?.p95WindowMs ?? 60000}
                onChange={value =>
                  onUpdateField('loadBalancer', 'sloFallback', {
                    ...lb.sloFallback,
                    p95WindowMs: value,
                  })
                }
                min={1000}
                step={1000}
                suffix="ms"
                description="Rolling window for P95 TTFT"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Token Weighted Load</h4>
          <div className="space-y-4">
            <Toggle
              label="Enabled"
              checked={lb.tokenWeightedLoad?.enabled ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'tokenWeightedLoad', {
                  ...lb.tokenWeightedLoad,
                  enabled: value,
                })
              }
              description="Enable token-weighted request accounting"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Prompt Token Weight"
                value={lb.tokenWeightedLoad?.promptTokenWeight ?? 1.0}
                onChange={value =>
                  onUpdateField('loadBalancer', 'tokenWeightedLoad', {
                    ...lb.tokenWeightedLoad,
                    promptTokenWeight: value,
                  })
                }
                min={0}
                step={0.1}
                description="Weight multiplier for prompt tokens"
              />
              <NumberInput
                label="Output Token Weight"
                value={lb.tokenWeightedLoad?.outputTokenWeight ?? 4.0}
                onChange={value =>
                  onUpdateField('loadBalancer', 'tokenWeightedLoad', {
                    ...lb.tokenWeightedLoad,
                    outputTokenWeight: value,
                  })
                }
                min={0}
                step={0.1}
                description="Weight multiplier for output tokens"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Cold Start Magnitude</h4>
          <div className="space-y-4">
            <Toggle
              label="Enabled"
              checked={lb.coldStartMagnitude?.enabled ?? true}
              onChange={value =>
                onUpdateField('loadBalancer', 'coldStartMagnitude', {
                  ...lb.coldStartMagnitude,
                  enabled: value,
                })
              }
              description="Penalize servers with recent cold starts"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <NumberInput
                label="Threshold"
                value={lb.coldStartMagnitude?.thresholdMs ?? 1000}
                onChange={value =>
                  onUpdateField('loadBalancer', 'coldStartMagnitude', {
                    ...lb.coldStartMagnitude,
                    thresholdMs: value,
                  })
                }
                min={100}
                step={100}
                suffix="ms"
                description="TTFT threshold for cold start"
              />
              <NumberInput
                label="Penalty Duration"
                value={lb.coldStartMagnitude?.penaltyDurationMs ?? 60000}
                onChange={value =>
                  onUpdateField('loadBalancer', 'coldStartMagnitude', {
                    ...lb.coldStartMagnitude,
                    penaltyDurationMs: value,
                  })
                }
                min={1000}
                step={1000}
                suffix="ms"
                description="Duration of score penalty"
              />
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Ghost Servers</h4>
          <div className="space-y-4">
            <NumberInput
              label="Stale Threshold"
              value={lb.ghostServers?.staleThresholdMs ?? 300000}
              onChange={value =>
                onUpdateField('loadBalancer', 'ghostServers', {
                  ...lb.ghostServers,
                  staleThresholdMs: value,
                })
              }
              min={60000}
              step={10000}
              suffix="ms"
              description="Time before server marked as ghost"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

LoadBalancerTab.displayName = 'LoadBalancerTab';
