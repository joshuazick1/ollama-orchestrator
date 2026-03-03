import { screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Dashboard } from '../Dashboard';
import * as api from '../../api';

// Mock the API calls
vi.mock('../../api', () => ({
  getHealth: vi.fn(),
  getAnalyticsSummary: vi.fn(),
  getMetrics: vi.fn(),
}));

const mockHealthData = {
  status: 'ok',
  uptime: 3600,
  orchestrator: {
    healthyServers: 2,
    totalServers: 2,
    totalModels: 5,
    inFlightRequests: 10,
    circuitBreakers: {
      server1: { state: 'closed' },
      server2: { state: 'closed' },
    },
  },
};

const mockAnalyticsData = {
  global: {
    totalRequests: 1500,
    avgLatency: 120.5,
    errorRate: 0.01,
  },
};

const mockMetricsData = {
  global: {
    streaming: {
      totalStreamingRequests: 500,
      avgChunkCount: 15.2,
      avgTTFT: 45.3,
      streamingPercentage: 33.3,
    },
  },
};

describe('Dashboard Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getHealth as any).mockResolvedValue(mockHealthData);
    (api.getAnalyticsSummary as any).mockResolvedValue(mockAnalyticsData);
    (api.getMetrics as any).mockResolvedValue(mockMetricsData);
  });

  it('renders loading state initially', () => {
    // Return unresolved promises to keep it in loading state
    (api.getHealth as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Dashboard />);

    expect(screen.getByText('Loading system status...')).toBeInTheDocument();
  });

  it('renders error state when health check fails', async () => {
    (api.getHealth as any).mockRejectedValue(new Error('Failed to fetch'));

    renderWithProviders(<Dashboard />);

    expect(
      await screen.findByText(
        'Unable to connect to the orchestrator. Please check if the service is running.'
      )
    ).toBeInTheDocument();
  });

  it('renders dashboard with stats when data loads successfully', async () => {
    renderWithProviders(<Dashboard />);

    // Check main headers
    expect(await screen.findByText('Dashboard Overview')).toBeInTheDocument();

    // Check health stats
    expect(await screen.findByText('2/2')).toBeInTheDocument(); // Active Servers
    expect(await screen.findByText('All nodes healthy')).toBeInTheDocument();

    const elements = await screen.findAllByText('10');
    expect(elements.length).toBeGreaterThan(0); // In-Flight Requests

    // Check analytics stats
    expect(await screen.findByText('1,500')).toBeInTheDocument(); // Total Requests
    expect(await screen.findByText('121ms')).toBeInTheDocument(); // Avg Latency

    // Check metrics (streaming)
    expect(await screen.findByText('500')).toBeInTheDocument(); // Streaming Requests
    expect(await screen.findByText('15.2')).toBeInTheDocument(); // Avg Chunks
    expect(await screen.findByText('45ms')).toBeInTheDocument(); // Avg TTFT
    expect(await screen.findByText('33.3%')).toBeInTheDocument(); // Streaming %
  });

  it('shows unhealthy server counts', async () => {
    const unhealthyData = {
      ...mockHealthData,
      orchestrator: {
        ...mockHealthData.orchestrator,
        healthyServers: 1,
        totalServers: 3,
      },
    };
    (api.getHealth as any).mockResolvedValue(unhealthyData);

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('1/3')).toBeInTheDocument();
    expect(await screen.findByText('2 nodes unhealthy')).toBeInTheDocument();
  });
});
