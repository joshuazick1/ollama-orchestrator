import type { LucideIcon } from 'lucide-react';
import { Loader2, AlertCircle, Inbox, Server, Database, FileText } from 'lucide-react';

export type EmptyStateType = 'loading' | 'empty' | 'error' | 'no-servers' | 'no-models' | 'no-logs';

interface EmptyStateProps {
  type: EmptyStateType;
  title?: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const defaultConfigs: Record<EmptyStateType, { icon: LucideIcon; title: string; message: string }> =
  {
    loading: {
      icon: Loader2,
      title: 'Loading...',
      message: 'Fetching data from the server.',
    },
    empty: {
      icon: Inbox,
      title: 'No data available',
      message: 'There is nothing to display here yet.',
    },
    error: {
      icon: AlertCircle,
      title: 'Something went wrong',
      message: 'An error occurred while loading data.',
    },
    'no-servers': {
      icon: Server,
      title: 'No servers configured',
      message: 'Add your first Ollama server to get started.',
    },
    'no-models': {
      icon: Database,
      title: 'No models available',
      message: 'No models have been loaded on any server yet.',
    },
    'no-logs': {
      icon: FileText,
      title: 'No logs available',
      message: 'System logs will appear here once available.',
    },
  };

export const EmptyState = ({ type, title, message, action }: EmptyStateProps) => {
  const config = defaultConfigs[type];
  const Icon = config.icon;

  if (type === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4">
        <Icon className="w-12 h-12 text-blue-500 animate-spin mb-4" />
        <h3 className="text-lg font-medium text-white mb-2">{title ?? config.title}</h3>
        <p className="text-gray-400 text-center">{message ?? config.message}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="p-4 rounded-full bg-gray-800 mb-4">
        <Icon className="w-12 h-12 text-gray-500" />
      </div>
      <h3 className="text-lg font-medium text-white mb-2">{title ?? config.title}</h3>
      <p className="text-gray-400 text-center max-w-md mb-6">{message ?? config.message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};

export const LoadingState = ({ message = 'Loading...' }: { message?: string }) => (
  <EmptyState type="loading" message={message} />
);

export const ErrorState = ({
  title,
  message,
  action,
}: {
  title?: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}) => <EmptyState type="error" title={title} message={message} action={action} />;

export const NoServersState = ({ action }: { action?: { label: string; onClick: () => void } }) => (
  <EmptyState type="no-servers" action={action} />
);

export const NoModelsState = () => <EmptyState type="no-models" />;

export const NoLogsState = () => <EmptyState type="no-logs" />;

export default EmptyState;
