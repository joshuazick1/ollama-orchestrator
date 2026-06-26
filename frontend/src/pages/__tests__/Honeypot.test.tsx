import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Honeypot } from '../Honeypot';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getHoneypotStats: vi.fn(),
  getHoneypotSummary: vi.fn(),
  getTopFlagged: vi.fn(),
  quarantineServer: vi.fn(),
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

const makeServer = (
  serverId: string,
  verdict: 'clean' | 'suspicious' | 'flagged',
  overrides: Partial<api.HoneypotServerResult> = {}
): api.HoneypotServerResult => ({
  serverId,
  url: `http://${serverId}.example.com:11434`,
  schemaScore: 0,
  coldStartScore: 0,
  watermarkScore: 0,
  compositeScore: verdict === 'clean' ? 10 : verdict === 'suspicious' ? 35 : 75,
  verdict,
  evidence: {},
  lastProbed: new Date().toISOString(),
  tier1Score: verdict === 'clean' ? 5 : verdict === 'suspicious' ? 30 : 60,
  ...overrides,
});

const mockHoneypotStatsData: api.HoneypotStatsResponse = {
  enabled: true,
  intervalMs: 21600000,
  summary: {
    totalServers: 3,
    scored: 3,
    clean: 1,
    suspicious: 1,
    flagged: 1,
    tier1Signals: 2,
    tier2Signals: 1,
    tier3Signals: 0,
  },
  tier1Probes: ['schemaConformance', 'coldStartTiming', 'watermark'],
  tier2Probes: ['httpHeaderConsistency', 'outputEntropy', 'tlsFingerprint'],
  tier3Probes: ['ipAsnReputation', 'recursiveCallback'],
  results: [
    makeServer('server1', 'clean'),
    makeServer('server2', 'suspicious'),
    makeServer('server3', 'flagged'),
  ],
};

const mockSummaryData: api.HoneypotSummary = {
  enabled: true,
  totalServers: 3,
  scored: 3,
  clean: 1,
  suspicious: 1,
  flagged: 1,
  quarantined: 1,
  tier1Signals: 2,
  tier2Signals: 1,
  tier3Signals: 0,
  avgTier1Score: 32,
  avgTier2Score: 15,
  avgTier3Score: 0,
  avgCompositeScore: 38,
};

describe('Honeypot Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getHoneypotStats as any).mockResolvedValue(mockHoneypotStatsData);
    (api.getHoneypotSummary as any).mockResolvedValue(mockSummaryData);
    (api.getTopFlagged as any).mockResolvedValue({ results: [], count: 0 });
    (api.quarantineServer as any).mockResolvedValue({ success: true });
  });

  it('renders loading state initially', () => {
    (api.getHoneypotStats as any).mockReturnValue(new Promise(() => {}));
    (api.getHoneypotSummary as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Honeypot />);

    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('renders summary cards with correct counts', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('Total Scored')).toBeInTheDocument();
    });

    const allThrees = screen.getAllByText('3');
    expect(allThrees[0]).toBeInTheDocument();
    expect(screen.getByText('Clean', { selector: 'p.text-text-muted' })).toBeInTheDocument();
    expect(screen.getByText('Suspicious', { selector: 'p.text-text-muted' })).toBeInTheDocument();
    expect(screen.getByText('Flagged', { selector: 'p.text-text-muted' })).toBeInTheDocument();
    expect(screen.getByText('Quarantined')).toBeInTheDocument();
  });

  it('renders data table with server rows', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
    expect(screen.getByText('server3')).toBeInTheDocument();
  });

  it('shows verdict badges with correct colors', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const cleanBadges = screen.getAllByText('clean');
    expect(cleanBadges.length).toBeGreaterThan(0);

    const suspiciousBadges = screen.getAllByText('suspicious');
    expect(suspiciousBadges.length).toBeGreaterThan(0);

    const flaggedBadges = screen.getAllByText('flagged');
    expect(flaggedBadges.length).toBeGreaterThan(0);
  });

  it('filter by verdict works', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const verdictFilter = screen.getAllByRole('combobox')[0];
    fireEvent.change(verdictFilter, { target: { value: 'flagged' } });

    await waitFor(() => {
      expect(screen.queryByText('server1')).not.toBeInTheDocument();
    });

    expect(screen.getByText('server3')).toBeInTheDocument();
  });

  it('search by server ID works', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by server id or url/i);
    fireEvent.change(searchInput, { target: { value: 'server2' } });

    await waitFor(() => {
      expect(screen.queryByText('server1')).not.toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
  });

  it('quarantine button opens confirmation modal', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const quarantineButton = screen.getAllByText('Quarantine')[0];
    fireEvent.click(quarantineButton);

    await waitFor(() => {
      expect(screen.getByText('Quarantine Server?')).toBeInTheDocument();
    });
  });

  it('quarantine action calls API', async () => {
    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    const quarantineButton = screen.getAllByText('Quarantine')[0];
    fireEvent.click(quarantineButton);

    await waitFor(() => {
      expect(screen.getByText('Quarantine Server?')).toBeInTheDocument();
    });

    const confirmButton = within(screen.getByRole('alertdialog')).getByRole('button', {
      name: /^quarantine$/i,
    });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(api.quarantineServer).toHaveBeenCalledWith('server1', 'manual', undefined);
    });
  });

  it('shows empty state when no servers scored', async () => {
    (api.getHoneypotStats as any).mockResolvedValue({
      ...mockHoneypotStatsData,
      results: [],
    });

    renderWithProviders(<Honeypot />);

    await waitFor(() => {
      expect(screen.getByText('No servers scored yet')).toBeInTheDocument();
    });
  });
});
