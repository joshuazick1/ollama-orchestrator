import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ProgressBar } from '../ProgressBar';

describe('ProgressBar', () => {
  it('renders with default color (blue) and default size (md → h-2)', () => {
    render(<ProgressBar value={50} />);
    const outer = screen.getByRole('progressbar');
    expect(outer).toBeInTheDocument();
    expect(outer.className).toContain('h-2');
    const inner = outer.querySelector('div');
    expect(inner?.className).toContain('bg-blue-500');
  });

  it('clamps value to [0, 100] when over', () => {
    render(<ProgressBar value={150} />);
    const outer = screen.getByRole('progressbar');
    expect(outer).toHaveAttribute('aria-valuenow', '100');
  });

  it('clamps value to [0, 100] when under', () => {
    render(<ProgressBar value={-20} />);
    const outer = screen.getByRole('progressbar');
    expect(outer).toHaveAttribute('aria-valuenow', '0');
  });

  it('accepts max prop and computes percentage (value=50, max=200 → 25%)', () => {
    render(<ProgressBar value={50} max={200} />);
    const outer = screen.getByRole('progressbar');
    expect(outer).toHaveAttribute('aria-valuenow', '25');
  });

  it('sets aria-label when provided', () => {
    render(<ProgressBar value={50} ariaLabel="Test label" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'Test label');
  });

  it('sets aria-valuenow, aria-valuemin, and aria-valuemax on progressbar', () => {
    render(<ProgressBar value={75} />);
    const outer = screen.getByRole('progressbar');
    expect(outer).toHaveAttribute('aria-valuenow', '75');
    expect(outer).toHaveAttribute('aria-valuemin', '0');
    expect(outer).toHaveAttribute('aria-valuemax', '100');
  });

  it('applies custom className to the outer wrapper', () => {
    render(<ProgressBar value={50} className="custom-class" />);
    const outer = screen.getByRole('progressbar');
    expect(outer.className).toContain('custom-class');
  });

  it('renders with green color when specified', () => {
    render(<ProgressBar value={50} color="green" />);
    const outer = screen.getByRole('progressbar');
    const inner = outer.querySelector('div');
    expect(inner?.className).toContain('bg-green-500');
  });

  it('renders with purple color when specified', () => {
    render(<ProgressBar value={50} color="purple" />);
    const outer = screen.getByRole('progressbar');
    const inner = outer.querySelector('div');
    expect(inner?.className).toContain('bg-purple-500');
  });

  it('renders with sm size (h-1) when specified', () => {
    render(<ProgressBar value={50} size="sm" />);
    const outer = screen.getByRole('progressbar');
    const inner = outer.querySelector('div');
    expect(inner?.className).toContain('h-1');
  });
});
