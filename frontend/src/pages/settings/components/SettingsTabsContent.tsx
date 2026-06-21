import { memo } from 'react';
import type { OrchestratorConfig } from '../../../api';
import { GeneralTab } from '../tabs/GeneralTab';
import { QueueTab } from '../tabs/QueueTab';
import { RateLimitTab } from '../tabs/RateLimitTab';
import { LoadBalancerTab } from '../tabs/LoadBalancerTab';
import { SecurityTab } from '../tabs/SecurityTab';
import { LoggingTab } from '../tabs/LoggingTab';
import { UsersTab } from '../UsersTab';
import { CircuitBreakerTab } from '../tabs/CircuitBreakerTab';
import { MetricsTab } from '../tabs/MetricsTab';
import { HealthCheckTab } from '../tabs/HealthCheckTab';
import { RetryTab } from '../tabs/RetryTab';
import { StorageTab } from '../tabs/StorageTab';
import { StreamingTab } from '../tabs/StreamingTab';
import { ModelManagerTab } from '../tabs/ModelManagerTab';
import { TimeoutTab } from '../tabs/TimeoutTab';
import { RecoveryTestTab } from '../tabs/RecoveryTestTab';
import { ProbeTab } from '../tabs/ProbeTab';
import { AdvancedTab } from '../tabs/AdvancedTab';
import { TabsContent } from '../../../components/ui/tabs';

interface SettingsTabsContentProps {
  config: OrchestratorConfig;
  updateField: <K extends keyof OrchestratorConfig>(
    section: K,
    field: keyof OrchestratorConfig[K] | null,
    value: unknown
  ) => void;
}

export const SettingsTabsContent = memo<SettingsTabsContentProps>(({ config, updateField }) => {
  const storageUpdateField: (section: string, field: string | null, value: unknown) => void = (
    section,
    field,
    value
  ) => {
    updateField(
      section as keyof OrchestratorConfig,
      field as keyof OrchestratorConfig[keyof OrchestratorConfig] | null,
      value
    );
  };

  return (
    <>
      <TabsContent value="general">
        <GeneralTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="queue">
        <QueueTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="loadbalancer">
        <LoadBalancerTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="ratelimit">
        <RateLimitTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="security">
        <SecurityTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="logging">
        <LoggingTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="users">
        <UsersTab />
      </TabsContent>

      <TabsContent value="circuitbreaker">
        <CircuitBreakerTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="metrics">
        <MetricsTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="healthcheck">
        <HealthCheckTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="retry">
        <RetryTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="storage">
        <StorageTab config={config} onUpdateField={storageUpdateField} />
      </TabsContent>

      <TabsContent value="streaming">
        <StreamingTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="modelmanager">
        <ModelManagerTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="timeout">
        <TimeoutTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="recoverytest">
        <RecoveryTestTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="probe">
        <ProbeTab config={config} onUpdateField={updateField} />
      </TabsContent>

      <TabsContent value="advanced">
        <AdvancedTab config={config} onUpdateField={updateField} />
      </TabsContent>
    </>
  );
});

SettingsTabsContent.displayName = 'SettingsTabsContent';
