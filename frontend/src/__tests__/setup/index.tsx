import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { ModelPullsProvider } from '../../hooks/useModelPulls';

export const wrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ModelPullsProvider>{children}</ModelPullsProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
};

export const renderWithProviders = (ui: ReactNode) => {
  return rtlRender(ui, { wrapper });
};

export * from '@testing-library/react';
export { rtlRender as render };
