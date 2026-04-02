import { screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { InFlight } from '../InFlight';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getInFlightByServer: vi.fn(),
}));

vi.mock('../../utils/formatting', () => ({
  formatDuration: vi.fn().mockReturnValue('5s'),
}));

const mockInFlightData = {
  total: 3,
  inFlight: [
    {
      serverId: 'server1',
      serverUrl: 'http://localhost:11434',
      healthy: true,
      total: 2,
      byModel: {
        llama2: { regular: 2, bypass: 0 },
      },
      streamingRequests: [],
    },
    {
      serverId: 'server2',
      serverUrl: 'http://remote:11434',
      healthy: false,
      total: 1,
      byModel: {
        mistral: { regular: 1, bypass: 0 },
      },
      streamingRequests: [],
    },
  ],
};

const mockWithStreaming = {
  total: 2,
  inFlight: [
    {
      serverId: 'server1',
      serverUrl: 'http://localhost:11434',
      healthy: true,
      total: 2,
      byModel: {},
      streamingRequests: [
        {
          id: 'req-abc12345',
          model: 'llama2',
          startTime: Date.now() - 5000,
          chunkCount: 42,
          isStalled: false,
        },
      ],
    },
  ],
};

const mockWithStalledRequest = {
  total: 1,
  inFlight: [
    {
      serverId: 'server1',
      serverUrl: 'http://localhost:11434',
      healthy: true,
      total: 1,
      byModel: {},
      streamingRequests: [
        {
          id: 'stalled-req-xyz',
          model: 'llama2',
          startTime: Date.now() - 60000,
          chunkCount: 3,
          isStalled: true,
        },
      ],
    },
  ],
};

describe('InFlight Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getInFlightByServer as any).mockResolvedValue(mockInFlightData);
  });

  it('renders loading skeleton initially', () => {
    (api.getInFlightByServer as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<InFlight />);

    expect(screen.getByText('In-Flight Requests')).toBeInTheDocument();
    expect(screen.getByText('Monitor active in-flight operations by server')).toBeInTheDocument();
    expect(screen.queryByText('server1')).not.toBeInTheDocument();
  });

  it('displays server data with in-flight counts', async () => {
    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    expect(screen.getByText('server2')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:11434')).toBeInTheDocument();
    expect(screen.getByText('http://remote:11434')).toBeInTheDocument();
  });

  it('shows total in-flight count in stat card', async () => {
    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getByText('Total In-Flight')).toBeInTheDocument();
    });

    expect(screen.getByText('Active requests')).toBeInTheDocument();
  });

  it('shows streaming requests section when streaming data present', async () => {
    (api.getInFlightByServer as any).mockResolvedValue(mockWithStreaming);

    renderWithProviders(<InFlight />);

    // Wait for server data to render (not the stat card title which is always present)
    await waitFor(() => {
      expect(screen.getByText('server1')).toBeInTheDocument();
    });

    // The streaming section header inside the server card
    expect(screen.getAllByText('Streaming Requests').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('llama2')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows stalled request indicator when a streaming request is stalled', async () => {
    (api.getInFlightByServer as any).mockResolvedValue(mockWithStalledRequest);

    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getByText('Stalled')).toBeInTheDocument();
    });

    expect(screen.getByText('Stalled Streams')).toBeInTheDocument();
    expect(screen.getByText('Needs attention')).toBeInTheDocument();
  });

  it('shows empty state when no in-flight data', async () => {
    (api.getInFlightByServer as any).mockResolvedValue({ total: 0, inFlight: [] });

    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getByText('No in-flight requests found')).toBeInTheDocument();
    });
  });

  it('displays model breakdown within server card', async () => {
    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getAllByText('Requests by Model').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('llama2')).toBeInTheDocument();
    expect(screen.getByText('mistral')).toBeInTheDocument();
  });

  it('shows non-streaming stat card when no stalled requests', async () => {
    renderWithProviders(<InFlight />);

    await waitFor(() => {
      expect(screen.getByText('Non-Streaming')).toBeInTheDocument();
    });

    expect(screen.getByText('Standard requests')).toBeInTheDocument();
  });
});
