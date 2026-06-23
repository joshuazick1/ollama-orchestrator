import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../../__tests__/setup';
import { ServerCard } from '../ServerCard';
import type { AIServer } from '../../../types';

vi.mock('../ServerActionsMenu', () => ({
  ServerActionsMenu: vi.fn(() => <div data-testid="server-actions-menu">Actions Menu</div>),
}));

const mockServer: AIServer = {
  id: 'test-server-123',
  url: 'http://localhost:11434',
  type: 'ollama',
  lastResponseTime: 45,
  models: ['llama2', 'mistral'],
  version: '0.1.0',
  healthy: true,
  supportsOllama: true,
  supportsV1: true,
  maxConcurrency: 4,
};

const mockUnhealthyServer: AIServer = {
  id: 'unhealthy-server-456',
  url: 'http://remote:11434',
  type: 'ollama',
  lastResponseTime: 1200,
  models: ['llama2'],
  version: '0.1.1',
  healthy: false,
  supportsOllama: true,
  supportsV1: false,
  maxConcurrency: 4,
};

const defaultProps = {
  server: mockServer,
  metricsData: undefined,
  expandedServerId: null,
  setExpandedServerId: vi.fn(),
  isServerPulling: vi.fn(() => false),
  getServerPulls: vi.fn(() => []),
  setModelManagerServer: vi.fn(),
  setServerToDelete: vi.fn(),
  setProbeConfirmation: vi.fn(),
};

describe('ServerCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders server name (URL)', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('http://localhost:11434')).toBeInTheDocument();
  });

  it('renders server ID (truncated)', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('test-ser')).toBeInTheDocument();
  });

  it('renders model count', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('2 Models')).toBeInTheDocument();
  });

  it('renders server version', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
  });

  it('displays Healthy badge for healthy server', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('displays Unhealthy badge for unhealthy server', () => {
    renderWithProviders(<ServerCard {...defaultProps} server={mockUnhealthyServer} />);
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();
  });

  it('displays response time in milliseconds', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getByText('45ms')).toBeInTheDocument();
  });

  it('displays high response time in yellow for slow servers', () => {
    renderWithProviders(<ServerCard {...defaultProps} server={mockUnhealthyServer} />);
    expect(screen.getByText('1200ms')).toBeInTheDocument();
  });

  it('displays dash for zero response time', () => {
    const serverWithNoResponse: AIServer = { ...mockServer, lastResponseTime: 0 };
    renderWithProviders(<ServerCard {...defaultProps} server={serverWithNoResponse} />);
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('renders Ollama badge for ollama type', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    const ollamaBadges = screen.getAllByText('Ollama');
    expect(ollamaBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders OpenAI badge when supportsV1 is true', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);
    expect(screen.getAllByText('OpenAI').length).toBeGreaterThan(0);
  });

  it('calls setExpandedServerId when card is clicked', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);

    const card = screen.getByText('http://localhost:11434').closest('.cursor-pointer');
    if (card) {
      fireEvent.click(card);
    }

    expect(defaultProps.setExpandedServerId).toHaveBeenCalledWith('test-server-123');
  });

  it('collapses card when expanded card is clicked', () => {
    renderWithProviders(<ServerCard {...defaultProps} expandedServerId="test-server-123" />);

    const card = screen.getByText('http://localhost:11434').closest('.cursor-pointer');
    if (card) {
      fireEvent.click(card);
    }

    expect(defaultProps.setExpandedServerId).toHaveBeenCalledWith(null);
  });

  it('calls setServerToDelete when delete button is clicked', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);

    const deleteButton = screen.getByRole('button', { name: /remove server/i });
    fireEvent.click(deleteButton);

    expect(defaultProps.setServerToDelete).toHaveBeenCalledWith(mockServer);
  });

  it('does not call setServerToDelete when card is clicked (stopPropagation)', () => {
    renderWithProviders(<ServerCard {...defaultProps} />);

    const card = screen.getByText('http://localhost:11434').closest('.cursor-pointer');
    if (card) {
      fireEvent.click(card);
    }

    expect(defaultProps.setServerToDelete).not.toHaveBeenCalled();
  });

  it('shows pulling badge when isServerPulling returns true', () => {
    const pullingProps = {
      ...defaultProps,
      isServerPulling: vi.fn(() => true),
      getServerPulls: vi.fn(() => [{ status: 'downloading' }, { status: 'downloading' }]),
    };
    renderWithProviders(<ServerCard {...pullingProps} />);
    expect(screen.getByText(/pulling \(2\)/i)).toBeInTheDocument();
  });

  it('shows expanded content when server is expanded', () => {
    renderWithProviders(<ServerCard {...defaultProps} expandedServerId="test-server-123" />);
    expect(screen.getByText('Server Details')).toBeInTheDocument();
  });

  it('renders ServerActionsMenu in expanded content', () => {
    renderWithProviders(<ServerCard {...defaultProps} expandedServerId="test-server-123" />);
    expect(screen.getByTestId('server-actions-menu')).toBeInTheDocument();
  });

  it('shows models list in expanded content', () => {
    renderWithProviders(<ServerCard {...defaultProps} expandedServerId="test-server-123" />);
    expect(screen.getByText('llama2')).toBeInTheDocument();
    expect(screen.getByText('mistral')).toBeInTheDocument();
  });

  it('displays "No models found" when server has no models', () => {
    const serverNoModels: AIServer = { ...mockServer, models: [] };
    renderWithProviders(
      <ServerCard {...defaultProps} server={serverNoModels} expandedServerId="test-server-123" />
    );
    expect(screen.getByText('No models found on this server')).toBeInTheDocument();
  });
});
