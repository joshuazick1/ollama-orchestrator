import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { Toaster } from './components/Toaster';
import { ModelPullsProvider } from './hooks/useModelPulls';
import { useServerEvents } from './hooks/useServerEvents';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ApiError } from './api';

const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Servers = lazy(() => import('./pages/Servers').then(m => ({ default: m.Servers })));
const Models = lazy(() => import('./pages/Models').then(m => ({ default: m.Models })));
const Analytics = lazy(() => import('./pages/analytics').then(m => ({ default: m.Analytics })));
const CircuitBreakers = lazy(() =>
  import('./pages/CircuitBreakers').then(m => ({ default: m.CircuitBreakers }))
);
const Logs = lazy(() => import('./pages/Logs').then(m => ({ default: m.Logs })));
const Settings = lazy(() => import('./pages/settings').then(m => ({ default: m.default })));
const InFlight = lazy(() => import('./pages/InFlight').then(m => ({ default: m.InFlight })));
const ErrorEvents = lazy(() =>
  import('./pages/ErrorEvents').then(m => ({ default: m.ErrorEvents }))
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10000,
      retry: (failureCount, error) => {
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

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function AppContent() {
  useServerEvents();

  return (
    <>
      <Toaster />
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<PageLoader />}>
              <Login />
            </Suspense>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<PageLoader />}>
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="servers"
            element={
              <Suspense fallback={<PageLoader />}>
                <Servers />
              </Suspense>
            }
          />
          <Route
            path="models"
            element={
              <Suspense fallback={<PageLoader />}>
                <Models />
              </Suspense>
            }
          />
          <Route
            path="analytics"
            element={
              <Suspense fallback={<PageLoader />}>
                <Analytics />
              </Suspense>
            }
          />
          <Route
            path="circuit-breakers"
            element={
              <Suspense fallback={<PageLoader />}>
                <CircuitBreakers />
              </Suspense>
            }
          />
          <Route
            path="logs"
            element={
              <Suspense fallback={<PageLoader />}>
                <Logs />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<PageLoader />}>
                <Settings />
              </Suspense>
            }
          />
          <Route
            path="in-flight"
            element={
              <Suspense fallback={<PageLoader />}>
                <InFlight />
              </Suspense>
            }
          />
          <Route
            path="errors"
            element={
              <Suspense fallback={<PageLoader />}>
                <ErrorEvents />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ModelPullsProvider>
            <BrowserRouter>
              <AppContent />
            </BrowserRouter>
          </ModelPullsProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
