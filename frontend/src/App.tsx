import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Toaster } from './components/Toaster';
import { Dashboard } from './pages/Dashboard';
import { Servers } from './pages/Servers';
import { Models } from './pages/Models';
import { Queue } from './pages/Queue';
import { Analytics } from './pages/Analytics';
import { CircuitBreakers } from './pages/CircuitBreakers';
import { Logs } from './pages/Logs';
import Settings from './pages/Settings';
import { ApiError } from './api';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof ApiError) {
          if (error.status && error.status >= 400 && error.status < 500) {
            return false;
          }
        }
        return failureCount < 3;
      },
      retryDelay: attemptIndex => Math.min(1000 * 2 ** attemptIndex, 30000),
    },
  },
});

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Toaster />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="servers" element={<Servers />} />
              <Route path="models" element={<Models />} />
              <Route path="queue" element={<Queue />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="circuit-breakers" element={<CircuitBreakers />} />
              <Route path="logs" element={<Logs />} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
