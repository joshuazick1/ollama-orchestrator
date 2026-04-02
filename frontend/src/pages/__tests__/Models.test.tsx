import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Models } from '../Models';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getModelMap: vi.fn(),
  getServers: vi.fn(),
  getCircuitBreakers: vi.fn(),
  getInFlightByServer: vi.fn(),
  warmupModel: vi.fn(),
  getWarmupRecommendations: vi.fn(),
  resetCircuitBreaker: vi.fn(),
  getAllModelsStatus: vi.fn(),
}));

vi.mock('focus-trap', () => ({
  createFocusTrap: vi.fn(() => ({
    activate: vi.fn(),
    deactivate: vi.fn(),
  })),
}));

vi.mock('../../utils/toast', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../../components/CircuitDetailModal', () => ({
  CircuitDetailModal: () => null,
}));

const mockModelMap: Record<string, string[]> = {
  llama2: ['server1', 'server2'],
  mistral: ['server1'],
};

const mockServers = [
  {
    id: 'server1',
    url: 'http://localhost:11434',
    healthy: true,
    lastResponseTime: 45,
    version: '0.1.0',
    models: ['llama2', 'mistral'],
    type: 'ollama',
  },
  {
    id: 'server2',
    url: 'http://remote:11434',
    healthy: true,
    lastResponseTime: 120,
    version: '0.1.1',
    models: ['llama2'],
    type: 'ollama',
  },
];

const mockCircuitBreakers = {
  success: true,
  circuitBreakers: [
    {
      serverId: 'server1:llama2',
      state: 'CLOSED',
      failureCount: 0,
      successCount: 10,
      totalRequestCount: 10,
      blockedRequestCount: 0,
      errorRate: 0,
      consecutiveSuccesses: 10,
      lastFailure: 0,
      lastSuccess: Date.now() - 5000,
      nextRetryAt: 0,
      halfOpenAttempts: 0,
      halfOpenStartedAt: 0,
      activeTestsInProgress: 0,
    },
  ],
};

const mockInFlight = {
  inFlight: [
    {
      serverId: 'server1',
      serverUrl: 'http://localhost:11434',
      healthy: true,
      count: 2,
      total: 4,
      byModel: {
        llama2: { regular: 2, bypass: 0 },
      },
    },
  ],
};

const mockRecommendations = {
  recommendations: [{ model: 'llama2', score: 0.9, reason: 'High usage' }],
};

const mockModelsStatus = {
  models: {
    llama2: {
      totalServers: 2,
      loadedOn: 1,
      loadingOn: 0,
      notLoadedOn: 1,
      failedOn: 0,
      servers: {
        server1: { loaded: true, loading: false },
        server2: { loaded: false, loading: false },
      },
    },
    mistral: {
      totalServers: 1,
      loadedOn: 0,
      loadingOn: 0,
      notLoadedOn: 1,
      failedOn: 0,
      servers: {
        server1: { loaded: false, loading: false },
      },
    },
  },
};

describe('Models Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getModelMap as any).mockResolvedValue(mockModelMap);
    (api.getServers as any).mockResolvedValue(mockServers);
    (api.getCircuitBreakers as any).mockResolvedValue(mockCircuitBreakers);
    (api.getInFlightByServer as any).mockResolvedValue(mockInFlight);
    (api.getWarmupRecommendations as any).mockResolvedValue(mockRecommendations);
    (api.getAllModelsStatus as any).mockResolvedValue(mockModelsStatus);
    (api.warmupModel as any).mockResolvedValue({ success: true });
    (api.resetCircuitBreaker as any).mockResolvedValue({ success: true });
  });

  it('renders loading skeleton when data is loading', () => {
    (api.getModelMap as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Models />);

    expect(screen.getByText('Models')).toBeInTheDocument();
    expect(screen.getByText('View and manage models across your servers')).toBeInTheDocument();
  });

  it('displays model data after loading', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText('mistral')).toBeInTheDocument();
  });

  it('shows empty state when no models match search', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'nonexistent-model-xyz' } });

    await waitFor(() => {
      expect(screen.getByText('No models found matching your search.')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    (api.getModelMap as any).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load data')).toBeInTheDocument();
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('displays replica count per model', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText('2 Nodes')).toBeInTheDocument();
    expect(screen.getByText('1 Nodes')).toBeInTheDocument();
  });

  it('renders server badges per model', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const server1Badges = screen.getAllByText('http://localhost:11434');
    expect(server1Badges.length).toBeGreaterThan(0);

    const server2Badges = screen.getAllByText('http://remote:11434');
    expect(server2Badges.length).toBeGreaterThan(0);
  });

  it('warmup button triggers mutation when recommendation exists', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const warmupButton = screen.getByRole('button', { name: /warmup recommended/i });
    expect(warmupButton).not.toBeDisabled();
    fireEvent.click(warmupButton);

    await waitFor(() => {
      expect(api.warmupModel).toHaveBeenCalledWith('llama2', undefined);
    });
  });

  it('warmup button is disabled when no recommendations', async () => {
    (api.getWarmupRecommendations as any).mockResolvedValue({ recommendations: [] });

    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const warmupButton = screen.getByRole('button', { name: /warmup recommended/i });
    expect(warmupButton).toBeDisabled();
  });

  it('search/filter functionality filters models by name', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
      expect(screen.getByText('mistral')).toBeInTheDocument();
    });

    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'mistral' } });

    await waitFor(() => {
      expect(screen.getByText('mistral')).toBeInTheDocument();
      expect(screen.queryByText('llama2')).not.toBeInTheDocument();
    });
  });

  it('displays model table with correct column headers', async () => {
    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    // 'Model Name' appears in both the sort dropdown and the table header
    const modelNameElements = screen.getAllByText('Model Name');
    expect(modelNameElements.length).toBeGreaterThanOrEqual(1);
    // 'Replicas' appears in both the sort dropdown and the table header
    const replicasElements = screen.getAllByText('Replicas');
    expect(replicasElements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Servers')).toBeInTheDocument();
  });

  it('shows circuit breaker open state badge when circuit is open', async () => {
    const openCircuitBreakers = {
      success: true,
      circuitBreakers: [
        {
          serverId: 'server1:llama2',
          state: 'OPEN',
          failureCount: 5,
          successCount: 0,
          totalRequestCount: 5,
          blockedRequestCount: 2,
          errorRate: 1.0,
          consecutiveSuccesses: 0,
          lastFailure: Date.now() - 10000,
          lastSuccess: 0,
          nextRetryAt: Date.now() + 120000,
          halfOpenAttempts: 0,
          halfOpenStartedAt: 0,
          activeTestsInProgress: 0,
        },
      ],
    };
    (api.getCircuitBreakers as any).mockResolvedValue(openCircuitBreakers);

    renderWithProviders(<Models />);

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const openBadges = screen.getAllByText('Open');
    expect(openBadges.length).toBeGreaterThan(0);
  });
});
