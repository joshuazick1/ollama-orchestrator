import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { CircuitBreakers } from '../CircuitBreakers';
import * as api from '../../api';
import * as circuitBreakersApi from '../../api/circuit-breakers';
import type { ProbeEndpoint } from '../../api/types';

vi.mock('../../api', () => ({
  getCircuitBreakers: vi.fn(),
  resetCircuitBreaker: vi.fn(),
  forceOpenCircuitBreaker: vi.fn(),
  forceCloseCircuitBreaker: vi.fn(),
  getBans: vi.fn(),
  removeBan: vi.fn(),
  clearAllBans: vi.fn(),
}));

vi.mock('../../api/circuit-breakers', () => ({
  resetBreakerForEndpoint: vi.fn(),
  forceOpenForEndpoint: vi.fn(),
  forceCloseForEndpoint: vi.fn(),
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

vi.mock('../../utils/formatting', () => ({
  formatTimeAgo: vi.fn((ts: number) => (ts > 0 ? '5m ago' : 'Never')),
  formatTimeUntil: vi.fn(() => '2m'),
}));

vi.mock('../../utils/circuitBreaker', () => ({
  getCircuitBreakerStateColor: vi.fn((state: string) => {
    if (state === 'OPEN') return 'text-red-400 bg-red-400/10 border-red-400/20';
    if (state === 'HALF-OPEN') return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
    return 'text-green-400 bg-green-400/10 border-green-400/20';
  }),
  getCircuitBreakerStateIcon: vi.fn(() => null),
  getStatePriority: vi.fn((state: string) => {
    if (state === 'OPEN') return 3;
    if (state === 'HALF-OPEN') return 2;
    if (state === 'CLOSED') return 1;
    return 0;
  }),
  sortByStatePriority: vi.fn((arr: api.CircuitBreakerInfo[]) => arr),
}));

const makeCb = (
  serverId: string,
  model: string,
  endpoint: ProbeEndpoint,
  state: 'OPEN' | 'CLOSED' | 'HALF-OPEN',
  overrides: Partial<api.CircuitBreakerInfo> = {}
): api.CircuitBreakerInfo => ({
  serverId,
  model,
  endpoint,
  state,
  uiState: state,
  failureCount: state === 'OPEN' ? 5 : state === 'HALF-OPEN' ? 2 : 0,
  successCount: state === 'CLOSED' ? 20 : state === 'HALF-OPEN' ? 1 : 0,
  totalRequestCount: state === 'CLOSED' ? 20 : state === 'HALF-OPEN' ? 3 : 5,
  blockedRequestCount: state === 'OPEN' ? 3 : 0,
  lastFailure: state === 'OPEN' ? Date.now() - 60000 : 0,
  lastSuccess:
    state === 'CLOSED' ? Date.now() - 5000 : state === 'HALF-OPEN' ? Date.now() - 10000 : 0,
  nextRetryAt: state === 'OPEN' ? Date.now() + 120000 : 0,
  errorRate: state === 'OPEN' ? 1.0 : 0,
  errorCounts: { retryable: 0, 'non-retryable': 0, transient: 0, permanent: 0, rateLimited: 0 },
  consecutiveSuccesses: state === 'CLOSED' ? 20 : 0,
  ...overrides,
});

const mockCircuitBreakersData = {
  success: true,
  circuitBreakers: [
    makeCb('server1', 'llama2', 'ollama_chat', 'OPEN', { failureCount: 5 }),
    makeCb('server1', 'llama2', 'ollama_generate', 'CLOSED'),
    makeCb('server1', 'llama2', 'ollama_embeddings', 'CLOSED'),
    makeCb('server1', 'llama2', 'openai_chat', 'CLOSED'),
    makeCb('server1', 'llama2', 'openai_completions', 'CLOSED'),
    makeCb('server1', 'llama2', 'openai_embeddings', 'CLOSED'),
    makeCb('server1', 'llama2', 'anthropic_messages', 'CLOSED'),
    makeCb('server1', 'mistral', 'ollama_chat', 'CLOSED'),
    makeCb('server1', 'mistral', 'ollama_generate', 'CLOSED'),
    makeCb('server1', 'mistral', 'ollama_embeddings', 'CLOSED'),
    makeCb('server1', 'mistral', 'openai_chat', 'CLOSED'),
    makeCb('server1', 'mistral', 'openai_completions', 'CLOSED'),
    makeCb('server1', 'mistral', 'openai_embeddings', 'CLOSED'),
    makeCb('server1', 'mistral', 'anthropic_messages', 'CLOSED'),
    makeCb('server2', 'llama2', 'ollama_chat', 'HALF-OPEN', {
      failureCount: 2,
      halfOpenAttempts: 1,
      halfOpenStartedAt: Date.now() - 30000,
    }),
    makeCb('server2', 'llama2', 'ollama_generate', 'CLOSED'),
    makeCb('server2', 'llama2', 'ollama_embeddings', 'CLOSED'),
    makeCb('server2', 'llama2', 'openai_chat', 'CLOSED'),
    makeCb('server2', 'llama2', 'openai_completions', 'CLOSED'),
    makeCb('server2', 'llama2', 'openai_embeddings', 'CLOSED'),
    makeCb('server2', 'llama2', 'anthropic_messages', 'CLOSED'),
    makeCb('server2', 'codellama', 'ollama_chat', 'CLOSED'),
    makeCb('server2', 'codellama', 'ollama_generate', 'CLOSED'),
    makeCb('server2', 'codellama', 'ollama_embeddings', 'CLOSED'),
    makeCb('server2', 'codellama', 'openai_chat', 'CLOSED'),
    makeCb('server2', 'codellama', 'openai_completions', 'CLOSED'),
    makeCb('server2', 'codellama', 'openai_embeddings', 'CLOSED'),
    makeCb('server2', 'codellama', 'anthropic_messages', 'CLOSED'),
  ],
  byState: { OPEN: 1, CLOSED: 26, HALF_OPEN: 1, UNKNOWN: 0 },
};

const mockBansData: api.BanEntry[] = [
  {
    serverId: 'server1',
    model: 'llama2',
    reason: 'Too many failures',
    bannedAt: Date.now() - 60000,
  },
  {
    serverId: 'server2',
    model: 'mistral',
    reason: 'OOM error',
    bannedAt: Date.now() - 30000,
  },
];

describe('CircuitBreakers Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getCircuitBreakers as any).mockResolvedValue(mockCircuitBreakersData);
    (api.getBans as any).mockResolvedValue(mockBansData);
    (api.resetCircuitBreaker as any).mockResolvedValue({ success: true });
    (api.forceOpenCircuitBreaker as any).mockResolvedValue({ success: true });
    (api.forceCloseCircuitBreaker as any).mockResolvedValue({ success: true });
    (api.removeBan as any).mockResolvedValue({ success: true });
    (api.clearAllBans as any).mockResolvedValue({ success: true });
    (circuitBreakersApi.resetBreakerForEndpoint as any).mockResolvedValue({ success: true });
    (circuitBreakersApi.forceOpenForEndpoint as any).mockResolvedValue({ success: true });
    (circuitBreakersApi.forceCloseForEndpoint as any).mockResolvedValue({ success: true });
  });

  it('renders loading state initially', () => {
    (api.getCircuitBreakers as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<CircuitBreakers />);

    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('displays circuit breakers grouped by server after loading', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
    expect(
      screen.getByText('Monitor circuit breaker status and banned server:model pairs')
    ).toBeInTheDocument();
  });

  it('shows correct summary counts for OPEN, HALF-OPEN, and CLOSED states', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('Open Circuits')).toBeInTheDocument();
    });

    expect(screen.getByText('Closed Circuits')).toBeInTheDocument();

    const openCount = screen.getByText('1', { selector: '.text-red-400' });
    expect(openCount).toBeInTheDocument();

    const halfOpenCount = screen.getByText('1', { selector: '.text-yellow-400' });
    expect(halfOpenCount).toBeInTheDocument();

    const closedCount = screen.getByText('26', { selector: '.text-green-400' });
    expect(closedCount).toBeInTheDocument();
  });

  it('expands server group and shows model-level circuit breakers', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
      expect(screen.getByText('mistral')).toBeInTheDocument();
    });
  });

  it('reset button triggers resetCircuitBreaker mutation for all endpoints', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('server1'));
    });

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText('HAS OPEN CIRCUIT')).toBeInTheDocument();
  });

  it('per-endpoint reset button triggers resetBreakerForEndpoint mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('server1'));
    });

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText('mistral')).toBeInTheDocument();
  });

  it('per-endpoint force open button triggers forceOpenForEndpoint mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('llama2'));

    await waitFor(() => {
      const openButtons = screen.getAllByTitle('Force Open');
      expect(openButtons.length).toBeGreaterThan(0);
    });

    const openButtons = screen.getAllByTitle('Force Open');
    const enabledOpenButton = openButtons.find(btn => !btn.hasAttribute('disabled'));
    expect(enabledOpenButton).toBeTruthy();
    fireEvent.click(enabledOpenButton!);

    await waitFor(() => {
      expect(circuitBreakersApi.forceOpenForEndpoint).toHaveBeenCalled();
    });
  });

  it('per-endpoint force close button triggers forceCloseForEndpoint mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('llama2'));

    await waitFor(() => {
      const closeButtons = screen.getAllByTitle('Force Close');
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    const closeButtons = screen.getAllByTitle('Force Close');
    const enabledCloseButton = closeButtons.find(btn => !btn.hasAttribute('disabled'));
    expect(enabledCloseButton).toBeTruthy();
    fireEvent.click(enabledCloseButton!);

    await waitFor(() => {
      expect(circuitBreakersApi.forceCloseForEndpoint).toHaveBeenCalled();
    });
  });

  it('shows bans tab with ban entries when switched', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const bansTab = screen.getByRole('button', { name: /bans/i });
    fireEvent.click(bansTab);

    await waitFor(() => {
      expect(screen.getByText('Too many failures')).toBeInTheDocument();
      expect(screen.getByText('OOM error')).toBeInTheDocument();
    });
  });

  it('empty state when no circuit breakers are active', async () => {
    (api.getCircuitBreakers as any).mockResolvedValue({
      success: true,
      circuitBreakers: [],
    });

    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('No Circuit Breakers Active')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Circuit breakers will appear here as servers handle requests and failures occur.'
      )
    ).toBeInTheDocument();
  });

  it('shows HAS OPEN CIRCUIT badge on server groups with open circuits', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('HAS OPEN CIRCUIT')).toBeInTheDocument();
  });

  it('shows empty bans state when no bans exist', async () => {
    (api.getBans as any).mockResolvedValue([]);

    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const bansTab = screen.getByRole('button', { name: /bans/i });
    fireEvent.click(bansTab);

    await waitFor(() => {
      expect(screen.getByText('No Banned Servers')).toBeInTheDocument();
    });
  });

  it('shows per-endpoint cards with endpoint chips when model is expanded', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('llama2'));

    await waitFor(() => {
      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Generate')).toBeInTheDocument();
      expect(screen.getByText('Embeddings')).toBeInTheDocument();
    });
  });

  it('shows worst-state at model row level based on endpoint aggregation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('llama2'));

    await waitFor(() => {
      const openBadges = screen.getAllByText('OPEN');
      expect(openBadges.length).toBeGreaterThan(0);
    });
  });

  it('shows divergent-count chip when model row is visible', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('server1'));
    });

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText(/divergent/i)).toBeInTheDocument();
  });

  it('shows endpoint count after model expansion', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('server1'));
    });

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    expect(screen.getByText('mistral')).toBeInTheDocument();
  });

  it('server group shows worst state via HAS OPEN CIRCUIT badge', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('HAS OPEN CIRCUIT')).toBeInTheDocument();
  });
});
