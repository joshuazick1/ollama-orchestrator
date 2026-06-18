import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from './ui/alert';
import { Button } from './Button';
import { toastError } from '../utils/toast';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    toastError('Something went wrong. Please try refreshing the page.');

    fetch('/api/orchestrator/logs/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: Date.now(),
      }),
    }).catch(() => undefined);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-4">
          <Alert variant="destructive" className="max-w-md bg-surface-raised border-red-500/20">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <AlertTitle className="text-white">Something went wrong</AlertTitle>
            <AlertDescription className="text-text-muted">
              An unexpected error occurred. Please try refreshing the page.
              <div className="mt-3 text-xs text-text-subtle font-mono bg-surface p-2 rounded">
                {this.state.error?.message}
              </div>
            </AlertDescription>
            <Button
              variant="primary"
              onClick={() => window.location.reload()}
              className="mt-4 w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh Page
            </Button>
          </Alert>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
