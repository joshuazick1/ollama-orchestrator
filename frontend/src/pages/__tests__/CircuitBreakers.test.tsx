import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { CircuitBreakers } from '../CircuitBreakers';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getCircuitBreakers: vi.fn(),
  resetCircuitBreaker: vi.fn(),
  forceOpenCircuitBreaker: vi.fn(),
  forceCloseCircuitBreaker: vi.fn(),
  getBans: vi.fn(),
  removeBan: vi.fn(),
  clearAllBans: vi.fn(),
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
}));

const makeCb = (
  serverId: string,
  state: 'OPEN' | 'CLOSED' | 'HALF-OPEN',
  overrides: Partial<api.CircuitBreakerInfo> = {}
): api.CircuitBreakerInfo => ({
  serverId,
  state,
  failureCount: state === 'OPEN' ? 5 : 0,
  successCount: state === 'CLOSED' ? 20 : 0,
  totalRequestCount: state === 'CLOSED' ? 20 : 5,
  blockedRequestCount: state === 'OPEN' ? 3 : 0,
  lastFailure: state === 'OPEN' ? Date.now() - 60000 : 0,
  lastSuccess: state === 'CLOSED' ? Date.now() - 5000 : 0,
  nextRetryAt: state === 'OPEN' ? Date.now() + 120000 : 0,
  errorRate: state === 'OPEN' ? 1.0 : 0,
  errorCounts: { retryable: 0, 'non-retryable': 0, transient: 0, permanent: 0, rateLimited: 0 },
  consecutiveSuccesses: state === 'CLOSED' ? 20 : 0,
  ...overrides,
});

const mockCircuitBreakersData = {
  success: true,
  circuitBreakers: [
    makeCb('server1:llama2', 'OPEN', { failureCount: 5 }),
    makeCb('server1:mistral', 'CLOSED'),
    makeCb('server2:llama2', 'HALF-OPEN', {
      failureCount: 3,
      halfOpenAttempts: 2,
      halfOpenStartedAt: Date.now() - 30000,
    }),
    makeCb('server2:codellama', 'CLOSED'),
  ],
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

    const closedCount = screen.getByText('2', { selector: '.text-green-400' });
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

  it('reset button triggers resetCircuitBreaker mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const resetButtons = screen.getAllByTitle('Reset');
    fireEvent.click(resetButtons[0]);

    await waitFor(() => {
      expect(api.resetCircuitBreaker).toHaveBeenCalled();
    });
  });

  it('force open button triggers forceOpenCircuitBreaker mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('mistral')).toBeInTheDocument();
    });

    const openButtons = screen.getAllByTitle('Force Open (block requests)');
    const enabledOpenButton = openButtons.find(btn => !btn.hasAttribute('disabled'));
    expect(enabledOpenButton).toBeTruthy();
    fireEvent.click(enabledOpenButton!);

    await waitFor(() => {
      expect(api.forceOpenCircuitBreaker).toHaveBeenCalled();
    });
  });

  it('force close button triggers forceCloseCircuitBreaker mutation', async () => {
    renderWithProviders(<CircuitBreakers />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('server1'));

    await waitFor(() => {
      expect(screen.getByText('llama2')).toBeInTheDocument();
    });

    const closeButtons = screen.getAllByTitle('Force Close (allow requests)');
    const enabledCloseButton = closeButtons.find(btn => !btn.hasAttribute('disabled'));
    expect(enabledCloseButton).toBeTruthy();
    fireEvent.click(enabledCloseButton!);

    await waitFor(() => {
      expect(api.forceCloseCircuitBreaker).toHaveBeenCalled();
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
});
