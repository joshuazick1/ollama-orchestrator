import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { APP_VERSION } from '../constants/app';

vi.mock('../api', () => ({
  getServers: vi.fn().mockResolvedValue([]),
  getModelMap: vi.fn().mockResolvedValue({}),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

describe('Layout', () => {
  it('renders the orchestrator title', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getAllByText('Orchestrator').length).toBeGreaterThan(0);
  });

  it('renders navigation items', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Servers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Models').length).toBeGreaterThan(0);
    expect(screen.getAllByText('In-Flight').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Analytics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Logs').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });

  it('renders the version number', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(screen.getAllByText(APP_VERSION).length).toBeGreaterThan(0);
  });

  it('renders sidebar navigation links with href attributes', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const dashboardLinks = screen.getAllByRole('link', { name: /dashboard/i });
    expect(dashboardLinks.length).toBeGreaterThan(0);
    expect(dashboardLinks[0]).toHaveAttribute('href', '/');
  });

  it('renders server page link', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Layout />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const serversLinks = screen.getAllByRole('link', { name: /servers/i });
    expect(serversLinks.length).toBeGreaterThan(0);
  });
});
