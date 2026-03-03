import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../__tests__/setup';
import { Servers } from '../Servers';
import * as api from '../../api';

vi.mock('../../api', () => ({
  getServers: vi.fn(),
  addServer: vi.fn(),
  removeServer: vi.fn(),
  drainServer: vi.fn(),
  undrainServer: vi.fn(),
  setServerMaintenance: vi.fn(),
  getMetrics: vi.fn(),
  getFleetModelStats: vi.fn(),
}));

vi.mock('focus-trap', () => ({
  createFocusTrap: vi.fn(() => ({
    activate: vi.fn(),
    deactivate: vi.fn(),
  })),
}));

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
    healthy: false,
    lastResponseTime: 1200,
    version: '0.1.1',
    models: ['llama2'],
    type: 'ollama',
  },
];

describe('Servers Page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getServers as any).mockResolvedValue(mockServers);
    (api.getMetrics as any).mockResolvedValue({});
  });

  it('renders loading skeletons initially', () => {
    (api.getServers as any).mockReturnValue(new Promise(() => {}));

    renderWithProviders(<Servers />);

    expect(screen.getByText('Servers')).toBeInTheDocument();
    expect(screen.getByText('Manage your AI inference nodes')).toBeInTheDocument();

    // It should render skeleton cards, checking for their existence via generic container class might be hard,
    // but we can check the heading exists and servers don't yet
    expect(screen.queryByText('http://localhost:11434')).not.toBeInTheDocument();
  });

  it('renders servers when loaded', async () => {
    renderWithProviders(<Servers />);

    expect(await screen.findByText('http://localhost:11434')).toBeInTheDocument();
    expect(await screen.findByText('http://remote:11434')).toBeInTheDocument();

    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('Unhealthy')).toBeInTheDocument();

    expect(screen.getByText('45ms')).toBeInTheDocument();
    expect(screen.getByText('1200ms')).toBeInTheDocument();
  });

  it('opens add server modal', async () => {
    renderWithProviders(<Servers />);

    // Wait for the page to load
    await screen.findByText('http://localhost:11434');

    const addButtons = screen.getAllByRole('button', { name: /add server/i });
    fireEvent.click(addButtons[0]);

    expect(screen.getByText('Add New Server')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('http://localhost:11434')).toBeInTheDocument();
  });

  it('validates server input and calls addServer', async () => {
    (api.addServer as any).mockResolvedValue({});

    renderWithProviders(<Servers />);
    await screen.findByText('http://localhost:11434');

    // Open modal
    const addButtons = screen.getAllByRole('button', { name: /add server/i });
    fireEvent.click(addButtons[0]);

    // Wait for modal
    const urlInput = screen.getByPlaceholderText('http://localhost:11434');

    // Try empty submit
    const submitButton = screen
      .getAllByRole('button', { name: /add server/i })
      .find(btn => btn.getAttribute('type') === 'submit');
    if (submitButton) fireEvent.click(submitButton);

    // Provide a valid URL and submit
    fireEvent.change(urlInput, { target: { value: 'http://newserver:11434' } });

    if (submitButton) fireEvent.click(submitButton);

    await waitFor(() => {
      expect(api.addServer).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://newserver:11434',
          type: 'ollama',
          id: expect.any(String),
        }),
        expect.anything()
      );
    });
  });

  it('expands server details on click', async () => {
    renderWithProviders(<Servers />);

    // The server card click target
    const serverCard = await screen.findByText('http://localhost:11434');
    fireEvent.click(serverCard);

    // Check if details are visible
    expect(await screen.findByText('Server Details')).toBeInTheDocument();

    // Models list
    expect(screen.getByText('llama2')).toBeInTheDocument();
    expect(screen.getByText('mistral')).toBeInTheDocument();
  });
});
