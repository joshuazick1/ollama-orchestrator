import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Logs } from '../Logs';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getLogs: vi.fn(),
  clearLogs: vi.fn(),
}));

vi.mock('../../utils/toast', () => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const mockLogsArray = [
  '[INFO] Server started on port 5100',
  '[WARN] High memory usage detected',
  '[ERROR] Connection timeout to server2',
];

const mockLogsString = '[INFO] Server started\n[DEBUG] Loading config\n[INFO] Ready';

describe('Logs Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getLogs as any).mockResolvedValue(mockLogsArray);
    (api.clearLogs as any).mockResolvedValue({});
  });

  it('renders loading skeleton initially', () => {
    (api.getLogs as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Logs />);

    expect(screen.getByText('System Logs')).toBeInTheDocument();
    expect(screen.getByText('View and manage application logs')).toBeInTheDocument();
    expect(screen.queryByText('[INFO] Server started on port 5100')).not.toBeInTheDocument();
  });

  it('displays log entries when loaded', async () => {
    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('[INFO] Server started on port 5100')).toBeInTheDocument();
    });

    expect(screen.getByText('[WARN] High memory usage detected')).toBeInTheDocument();
    expect(screen.getByText('[ERROR] Connection timeout to server2')).toBeInTheDocument();
  });

  it('handles array log format', async () => {
    (api.getLogs as any).mockResolvedValue(['log line one', 'log line two', 'log line three']);

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('log line one')).toBeInTheDocument();
    });

    expect(screen.getByText('log line two')).toBeInTheDocument();
    expect(screen.getByText('log line three')).toBeInTheDocument();
  });

  it('handles string log format by splitting on newlines', async () => {
    (api.getLogs as any).mockResolvedValue(mockLogsString);

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('[INFO] Server started')).toBeInTheDocument();
    });

    expect(screen.getByText('[DEBUG] Loading config')).toBeInTheDocument();
    expect(screen.getByText('[INFO] Ready')).toBeInTheDocument();
  });

  it('clear logs button triggers mutation and shows success toast', async () => {
    const { toastSuccess } = await import('../../utils/toast');

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('[INFO] Server started on port 5100')).toBeInTheDocument();
    });

    const clearButton = screen.getByRole('button', { name: /clear logs/i });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(api.clearLogs).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Logs cleared successfully');
    });
  });

  it('shows empty state message when no logs match', async () => {
    (api.getLogs as any).mockResolvedValue([]);

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('No logs found matching your search.')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    (api.getLogs as any).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load logs')).toBeInTheDocument();
    });

    expect(screen.getByText('Network error')).toBeInTheDocument();
  });

  it('shows retry button in error state', async () => {
    (api.getLogs as any).mockRejectedValue(new Error('Network error'));

    renderWithProviders(<Logs />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});
