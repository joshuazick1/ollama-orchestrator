import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Settings } from '../settings';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  saveConfig: vi.fn(),
  reloadConfig: vi.fn(),
}));

const mockConfig = {
  port: 5100,
  host: '0.0.0.0',
  logLevel: 'info',
  persistencePath: './data',
  configReloadIntervalMs: 0,
  enableQueue: true,
  enableCircuitBreaker: true,
  enableMetrics: true,
  enableStreaming: true,
  enablePersistence: true,
  loadBalancer: {
    weights: { latency: 0.35, successRate: 0.3, load: 0.2, capacity: 0.15 },
    thresholds: {
      maxP95Latency: 5000,
      minSuccessRate: 0.95,
      latencyPenalty: 0.5,
      errorPenalty: 0.3,
    },
    latencyBlendRecent: 0.6,
    latencyBlendHistorical: 0.4,
    loadFactorMultiplier: 0.5,
    defaultLatencyMs: 1000,
    defaultMaxConcurrency: 4,
  },
  circuitBreaker: {
    adaptiveThresholds: true,
    baseFailureThreshold: 5,
    maxFailureThreshold: 10,
    minFailureThreshold: 3,
    openTimeout: 120000,
    halfOpenTimeout: 60000,
    recoverySuccessThreshold: 3,
    halfOpenMaxRequests: 5,
    errorRateWindow: 60000,
    errorRateThreshold: 0.5,
    errorRateSmoothing: 0.3,
    adaptiveThresholdAdjustment: 2,
    nonRetryableRatioThreshold: 0.5,
    transientRatioThreshold: 0.7,
  },
  security: {
    rateLimitWindowMs: 60000,
    rateLimitMax: 100,
    corsOrigins: ['*'],
    apiKeyHeader: '',
  },
  metrics: {
    enabled: true,
    prometheusEnabled: true,
    prometheusPort: 9090,
    historyWindowMinutes: 60,
    decay: {
      enabled: true,
      halfLifeMs: 300000,
      minDecayFactor: 0.1,
      staleThresholdMs: 120000,
    },
  },
  streaming: {
    enabled: true,
    maxConcurrentStreams: 100,
    timeoutMs: 300000,
    bufferSize: 1024,
    ttftWeight: 0.6,
    durationWeight: 0.4,
    chunkWeight: 0.2,
    maxChunkGapPenaltyMs: 5000,
    stallThresholdMs: 300000,
    stallCheckIntervalMs: 10000,
    maxHandoffAttempts: 2,
  },
  healthCheck: {
    enabled: true,
    intervalMs: 30000,
    timeoutMs: 5000,
    maxConcurrentChecks: 10,
    retryAttempts: 2,
    retryDelayMs: 1000,
    recoveryIntervalMs: 60000,
    failureThreshold: 3,
    successThreshold: 2,
    backoffMultiplier: 1.5,
  },
  tags: {
    cacheTtlMs: 30000,
    maxConcurrentRequests: 10,
    batchDelayMs: 50,
    requestTimeoutMs: 5000,
  },
  retry: {
    maxRetriesPerServer: 2,
    retryDelayMs: 500,
    backoffMultiplier: 2,
    maxRetryDelayMs: 5000,
  },
  cooldown: {
    failureCooldownMs: 120000,
    defaultMaxConcurrency: 4,
  },
};

describe('Settings Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getConfig as any).mockResolvedValue(mockConfig);
    (api.updateConfig as any).mockResolvedValue(mockConfig);
    (api.saveConfig as any).mockResolvedValue({});
    (api.reloadConfig as any).mockResolvedValue({});
  });

  it('renders loading spinner while config is loading', () => {
    (api.getConfig as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Settings />);

    // A spinning icon is rendered — check the container is there
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders settings page with tabs after config loads', async () => {
    renderWithProviders(<Settings />);

    expect(await screen.findByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Configure orchestrator behavior and features')).toBeInTheDocument();

    // Check tabs are rendered
    expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /features/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load balancer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /security/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /metrics/i })).toBeInTheDocument();
  });

  it('shows general settings tab by default', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    // General settings section label text should be visible
    expect(screen.getByText('Port')).toBeInTheDocument();
    expect(screen.getByText('Host')).toBeInTheDocument();
    expect(screen.getByText('Log Level')).toBeInTheDocument();
    // Port input should be present with the config value
    expect(screen.getByDisplayValue('5100')).toBeInTheDocument();
  });

  it('switches to features tab and shows toggles', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    fireEvent.click(screen.getByRole('button', { name: /features/i }));

    expect(screen.getByText('Enable Queue')).toBeInTheDocument();
    expect(screen.getByText('Enable Circuit Breaker')).toBeInTheDocument();
    expect(screen.getByText('Enable Metrics')).toBeInTheDocument();
    expect(screen.getByText('Enable Streaming')).toBeInTheDocument();
    expect(screen.getByText('Enable Persistence')).toBeInTheDocument();
  });

  it('switches to security tab and shows security fields', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    fireEvent.click(screen.getByRole('button', { name: /^security$/i }));

    expect(screen.getByText('Access control settings')).toBeInTheDocument();
    expect(screen.getByText('CORS Origins')).toBeInTheDocument();
    expect(screen.getByDisplayValue('*')).toBeInTheDocument();
  });

  it('Save Changes button is disabled when no changes are made', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('enables Save Changes button after editing a field and calls updateConfig on save', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    // Change the port value via its display value
    const portInput = screen.getByDisplayValue('5100');
    fireEvent.change(portInput, { target: { value: '8080' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(api.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ port: 8080 }),
        expect.anything()
      );
    });
  });

  it('calls reloadConfig when Reload button is clicked', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));

    await waitFor(() => {
      expect(api.reloadConfig).toHaveBeenCalled();
    });
  });

  it('shows metrics tab content', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    fireEvent.click(screen.getByRole('button', { name: /metrics/i }));

    expect(screen.getByText('Monitoring and observability')).toBeInTheDocument();
    expect(screen.getByText('Metrics Enabled')).toBeInTheDocument();
    expect(screen.getByText('Prometheus Enabled')).toBeInTheDocument();
  });

  it('shows health check tab content', async () => {
    renderWithProviders(<Settings />);

    await screen.findByText('Settings');

    fireEvent.click(screen.getByRole('button', { name: /health check/i }));

    expect(screen.getByText('Server health monitoring settings')).toBeInTheDocument();
    expect(screen.getByText('Health Check Enabled')).toBeInTheDocument();
  });
});
