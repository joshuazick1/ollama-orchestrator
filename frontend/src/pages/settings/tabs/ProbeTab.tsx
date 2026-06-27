import { memo } from 'react';
import { Radar } from 'lucide-react';
import type { OrchestratorConfig, ProbeConfig } from '../../../types';
import { ConfigSection, Toggle } from '../components';
import { NumberInput } from '../components/NumberInput';

interface ProbeTabProps {
  config: OrchestratorConfig;
  onUpdateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

const DEFAULT_PROBE_CONFIG: ProbeConfig = {
  enabled: true,
  intervalMs: 30000,
  suspectAfterFailures: 1,
  unhealthyAfterFailures: 3,
  errorRateSuspectThreshold: 0.3,
  errorRateUnhealthyThreshold: 0.7,
  suspectWindowMs: 60000,
  recoveryBackoffMs: [10000, 30000, 60000, 300000, 900000],
  recoverySuccessThreshold: 5,
  probeTimeoutMs: 5000,
  maxConcurrentProbes: 10,
  snapshotIntervalMs: 300000,
  walTruncateThreshold: 10000,
};

export const ProbeTab = memo<ProbeTabProps>(({ config, onUpdateField }) => {
  // Wrapper for probe updates - handles the optional probe property type issue
  const updateProbeField = (field: string, value: unknown) => {
    (onUpdateField as (section: string, field: string | null, value: unknown) => void)(
      'probe',
      field,
      value
    );
  };

  const probeScheduler = config.probeScheduler || {
    enabled: true,
    intervalMs: 3600000,
    maxConcurrentProbes: 2,
    maxProbesPerServer: 1,
    probeTimeoutMs: 30000,
    cooldownAfterUserRequestMs: 300000,
    minSamplesForCoverage: 5,
    onlyDuringLowTraffic: true,
    lowTrafficThreshold: 0.3,
  };

  const probe: ProbeConfig = config.probe ?? DEFAULT_PROBE_CONFIG;

  const capabilityProbe = config.capabilityProbe || {
    enabled: true,
    intervalMs: 300000,
    consecutiveFailureThreshold: 3,
    requestTimeoutMs: 5000,
    staggerOffsetMs: 30000,
    allowPrivateNetwork: false,
  };

  return (
    <ConfigSection
      title="Probe"
      icon={Radar}
      description="Health probing, capability detection, and server monitoring"
    >
      <div className="space-y-6">
        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Probe Scheduler</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Probe Scheduler"
              checked={probeScheduler.enabled ?? true}
              onChange={value => onUpdateField('probeScheduler', 'enabled', value)}
              description="Enable scheduled probe operations"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <NumberInput
              label="Interval"
              value={probeScheduler.intervalMs ?? 3600000}
              onChange={value => onUpdateField('probeScheduler', 'intervalMs', value)}
              min={60000}
              step={1000}
              suffix="ms"
              description="Interval between probe cycles (1h default)"
            />
            <NumberInput
              label="Max Concurrent Probes"
              value={probeScheduler.maxConcurrentProbes ?? 2}
              onChange={value => onUpdateField('probeScheduler', 'maxConcurrentProbes', value)}
              min={1}
              max={10}
              description="Maximum concurrent probe operations"
            />
            <NumberInput
              label="Max Probes Per Server"
              value={probeScheduler.maxProbesPerServer ?? 1}
              onChange={value => onUpdateField('probeScheduler', 'maxProbesPerServer', value)}
              min={1}
              max={5}
              description="Maximum probes per server per cycle"
            />
            <NumberInput
              label="Probe Timeout"
              value={probeScheduler.probeTimeoutMs ?? 30000}
              onChange={value => onUpdateField('probeScheduler', 'probeTimeoutMs', value)}
              min={5000}
              max={300000}
              step={1000}
              suffix="ms"
              description="Timeout for probe requests"
            />
            <NumberInput
              label="Cooldown After User Request"
              value={probeScheduler.cooldownAfterUserRequestMs ?? 300000}
              onChange={value =>
                onUpdateField('probeScheduler', 'cooldownAfterUserRequestMs', value)
              }
              min={0}
              step={1000}
              suffix="ms"
              description="Cooldown after user request triggers probe"
            />
            <NumberInput
              label="Min Samples For Coverage"
              value={probeScheduler.minSamplesForCoverage ?? 5}
              onChange={value => onUpdateField('probeScheduler', 'minSamplesForCoverage', value)}
              min={1}
              description="Minimum samples for coverage"
            />
          </div>
          <div className="space-y-4 mt-4">
            <Toggle
              label="Only During Low Traffic"
              checked={probeScheduler.onlyDuringLowTraffic ?? true}
              onChange={value => onUpdateField('probeScheduler', 'onlyDuringLowTraffic', value)}
              description="Only probe when traffic is low"
            />
            <NumberInput
              label="Low Traffic Threshold"
              value={(probeScheduler.lowTrafficThreshold ?? 0.3) * 100}
              onChange={value =>
                onUpdateField('probeScheduler', 'lowTrafficThreshold', value / 100)
              }
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Traffic threshold for low traffic mode"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Probe</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Probe"
              checked={probe.enabled ?? true}
              onChange={value => updateProbeField('enabled', value)}
              description="Enable health probing"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <NumberInput
              label="Interval"
              value={probe.intervalMs ?? 30000}
              onChange={value => updateProbeField('intervalMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Probe interval"
            />
            <NumberInput
              label="Suspect After Failures"
              value={probe.suspectAfterFailures ?? 1}
              onChange={value => updateProbeField('suspectAfterFailures', value)}
              min={1}
              description="Failures before marking suspect"
            />
            <NumberInput
              label="Unhealthy After Failures"
              value={probe.unhealthyAfterFailures ?? 3}
              onChange={value => updateProbeField('unhealthyAfterFailures', value)}
              min={1}
              description="Failures before marking unhealthy"
            />
            <NumberInput
              label="Error Rate Suspect Threshold"
              value={(probe.errorRateSuspectThreshold ?? 0.3) * 100}
              onChange={value => updateProbeField('errorRateSuspectThreshold', value / 100)}
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Error rate for suspect state"
            />
            <NumberInput
              label="Error Rate Unhealthy Threshold"
              value={(probe.errorRateUnhealthyThreshold ?? 0.7) * 100}
              onChange={value => updateProbeField('errorRateUnhealthyThreshold', value / 100)}
              min={0}
              max={100}
              step={5}
              suffix="%"
              description="Error rate for unhealthy state"
            />
            <NumberInput
              label="Suspect Window"
              value={probe.suspectWindowMs ?? 60000}
              onChange={value => updateProbeField('suspectWindowMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Window for suspect state calculation"
            />
            <NumberInput
              label="Recovery Success Threshold"
              value={probe.recoverySuccessThreshold ?? 5}
              onChange={value => updateProbeField('recoverySuccessThreshold', value)}
              min={1}
              description="Consecutive successes for recovery"
            />
            <NumberInput
              label="Probe Timeout"
              value={probe.probeTimeoutMs ?? 5000}
              onChange={value => updateProbeField('probeTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout for probe requests"
            />
            <NumberInput
              label="Max Concurrent Probes"
              value={probe.maxConcurrentProbes ?? 10}
              onChange={value => updateProbeField('maxConcurrentProbes', value)}
              min={1}
              description="Maximum concurrent probes"
            />
            <NumberInput
              label="Snapshot Interval"
              value={probe.snapshotIntervalMs ?? 300000}
              onChange={value => updateProbeField('snapshotIntervalMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Interval for metrics snapshots"
            />
            <NumberInput
              label="WAL Truncate Threshold"
              value={probe.walTruncateThreshold ?? 10000}
              onChange={value => updateProbeField('walTruncateThreshold', value)}
              min={1}
              description="WAL truncate threshold"
            />
          </div>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-300 mb-3">Capability Probe</h4>
          <div className="space-y-4">
            <Toggle
              label="Enable Capability Probe"
              checked={capabilityProbe.enabled ?? true}
              onChange={value => onUpdateField('capabilityProbe', 'enabled', value)}
              description="Enable periodic negative probing"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <NumberInput
              label="Interval"
              value={capabilityProbe.intervalMs ?? 300000}
              onChange={value => onUpdateField('capabilityProbe', 'intervalMs', value)}
              min={60000}
              step={1000}
              suffix="ms"
              description="Capability probe interval (5 min default)"
            />
            <NumberInput
              label="Consecutive Failure Threshold"
              value={capabilityProbe.consecutiveFailureThreshold ?? 3}
              onChange={value =>
                onUpdateField('capabilityProbe', 'consecutiveFailureThreshold', value)
              }
              min={1}
              description="Consecutive failures before flagging"
            />
            <NumberInput
              label="Request Timeout"
              value={capabilityProbe.requestTimeoutMs ?? 5000}
              onChange={value => onUpdateField('capabilityProbe', 'requestTimeoutMs', value)}
              min={1000}
              step={1000}
              suffix="ms"
              description="Timeout for capability probe requests"
            />
            <NumberInput
              label="Stagger Offset"
              value={capabilityProbe.staggerOffsetMs ?? 30000}
              onChange={value => onUpdateField('capabilityProbe', 'staggerOffsetMs', value)}
              min={0}
              step={1000}
              suffix="ms"
              description="Stagger offset per server (0-30s)"
            />
          </div>
          <div className="space-y-4 mt-4">
            <Toggle
              label="Allow Private Network"
              checked={capabilityProbe.allowPrivateNetwork ?? false}
              onChange={value => onUpdateField('capabilityProbe', 'allowPrivateNetwork', value)}
              description="Allow probing private network servers"
            />
          </div>
        </div>
      </div>
    </ConfigSection>
  );
});

ProbeTab.displayName = 'ProbeTab';
