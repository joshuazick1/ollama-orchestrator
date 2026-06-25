import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Quarantine } from '../Quarantine';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getQuarantineList: vi.fn(),
  getGhostStats: vi.fn(),
  unquarantineServer: vi.fn(),
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

vi.mock('../../hooks/useLiveUpdates', () => ({
  useLiveUpdates: vi.fn(),
}));

const makeQuarantineEntry = (
  serverId: string,
  reason: 'honeypot-flagged' | 'manual' | 'auto-low-confidence',
  overrides: Partial<api.QuarantineEntry> = {}
): api.QuarantineEntry => ({
  serverId,
  quarantinedAt: Date.now() - 60000,
  reason,
  evidence: null,
  expiresAt: null,
  consecutiveCleanCycles: 0,
  isManual: reason === 'manual',
  ...overrides,
});

const mockQuarantineListData: api.QuarantineListResponse = {
  quarantined: [
    makeQuarantineEntry('server1', 'honeypot-flagged'),
    makeQuarantineEntry('server2', 'manual', { consecutiveCleanCycles: 2 }),
    makeQuarantineEntry('server3', 'auto-low-confidence', { consecutiveCleanCycles: 1 }),
  ],
  count: 3,
};

const mockGhostStatsData: api.GhostStats = {
  totalServers: 100,
  ghostServers: 5,
  ghostPercentage: 5,
  lastCycleAt: new Date().toISOString(),
  cycleIntervalMs: 300000,
};

describe('Quarantine Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getQuarantineList as any).mockResolvedValue(mockQuarantineListData);
    (api.getGhostStats as any).mockResolvedValue(mockGhostStatsData);
    (api.unquarantineServer as any).mockResolvedValue({ success: true });
  });

  it('renders loading state initially', () => {
    (api.getQuarantineList as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Quarantine />);

    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders summary cards with correct counts', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('Total Quarantined')).toBeInTheDocument();
    });

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Auto-Flagged')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders quarantined servers list', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
    expect(screen.getByText('server3')).toBeInTheDocument();
  });

  it('shows reason badges correctly', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Auto (Honeypot)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Manual').length).toBeGreaterThan(0);
  });

  it('filter by reason works', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const reasonFilter = screen.getByRole('combobox', { name: /reason/i });
    fireEvent.change(reasonFilter, { target: { value: 'honeypot-flagged' } });

    await waitFor(() => {
      expect(screen.queryByText('server2')).not.toBeInTheDocument();
    });

    expect(screen.getByText('server1')).toBeInTheDocument();
  });

  it('search by server ID works', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by server id or reason/i);
    fireEvent.change(searchInput, { target: { value: 'server2' } });

    await waitFor(() => {
      expect(screen.queryByText('server1')).not.toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
  });

  it('unquarantine button opens confirmation modal', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const unquarantineButtons = screen.getAllByText('Unquarantine');
    fireEvent.click(unquarantineButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Unquarantine Server?')).toBeInTheDocument();
    });
  });

  it('unquarantine action calls API', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const unquarantineButtons = screen.getAllByText('Unquarantine');
    fireEvent.click(unquarantineButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Unquarantine Server?')).toBeInTheDocument();
    });

    const confirmButton = screen.getByText('Unquarantine', { selector: 'button' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.unquarantineServer).toHaveBeenCalledWith('server1');
    });
  });

  it('shows empty state when no quarantined servers', async () => {
    (api.getQuarantineList as any).mockResolvedValue({
      quarantined: [],
      count: 0,
    });

    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('No quarantined servers')).toBeInTheDocument();
    });
  });

  it('displays recovery progress correctly', async () => {
    renderWithProviders(<Quarantine />);

    await waitFor(() => {
      expect(screen.getByText('server2')).toBeInTheDocument();
    });

    expect(screen.getByText('2/3')).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
  });
});
