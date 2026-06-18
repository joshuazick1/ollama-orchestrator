import { memo } from 'react';
import type { OrchestratorConfig } from '../../../api';
import { GeneralTab } from '../tabs/GeneralTab';
import { QueueTab } from '../tabs/QueueTab';
import { RateLimitTab } from '../tabs/RateLimitTab';
import { LoadBalancerTab } from '../tabs/LoadBalancerTab';
import { SecurityTab } from '../tabs/SecurityTab';
import { LoggingTab } from '../tabs/LoggingTab';
import { UsersTab } from '../UsersTab';
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
    </>
  );
});

SettingsTabsContent.displayName = 'SettingsTabsContent';
