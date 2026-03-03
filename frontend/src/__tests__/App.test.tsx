import { screen, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api', () => ({
  getServers: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue({}),
  getModelMap: vi.fn().mockResolvedValue({}),
  getHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
  getAnalyticsSummary: vi.fn().mockResolvedValue({}),
  getMetrics: vi.fn().mockResolvedValue({}),
  getFleetModelStats: vi.fn().mockResolvedValue([]),
}));

import App from '../App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(document.body).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    render(<App />);
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Servers').length).toBeGreaterThan(0);
  });

  it('renders the Layout with sidebar', () => {
    render(<App />);
    expect(screen.getAllByText('Orchestrator').length).toBeGreaterThan(0);
  });
});
