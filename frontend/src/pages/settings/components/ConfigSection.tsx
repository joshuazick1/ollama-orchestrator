import { memo, type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

interface ConfigSectionProps {
  title: string;
  icon: LucideIcon;
  description: string;
  children: ReactNode;
}

export const ConfigSection = memo<ConfigSectionProps>(
  ({ title, icon: Icon, description, children }) => {
    return (
      <div className="bg-surface rounded-xl border border-surface-border p-6">
        <div className="flex items-center gap-3 mb-4">
          <Icon className="w-5 h-5 text-blue-400" />
          <div>
            <h3 className="text-lg font-semibold text-text-base">{title}</h3>
            <p className="text-text-muted text-sm">{description}</p>
          </div>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    );
  }
);

ConfigSection.displayName = 'ConfigSection';
