import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

const { mockLogClientError } = vi.hoisted(() => {
  const fn = vi.fn<
    (p: {
      message: string;
      stack?: string;
      componentStack?: string;
      timestamp: number;
    }) => Promise<void>
  >(() => Promise.resolve());
  return { mockLogClientError: fn };
});

vi.mock('../../api', () => ({
  logClientError: mockLogClientError,
}));

const ThrowError = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  let consoleErrorMock: any;

  beforeEach(() => {
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn() },
      writable: true,
    });

    mockLogClientError.mockReset();
    mockLogClientError.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorMock.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('catches error and renders default fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowError message="Test error message" />
      </ErrorBoundary>
    );

    expect(console.error).toHaveBeenCalled();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('An unexpected error occurred. Please try refreshing the page.')
    ).toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();

    const reloadButton = screen.getByRole('button', { name: 'Refresh Page' });
    fireEvent.click(reloadButton);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('renders custom fallback if provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error View</div>}>
        <ThrowError message="Oops" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error View')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('calls logClientError with error details when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowError message="boom" />
      </ErrorBoundary>
    );

    expect(mockLogClientError).toHaveBeenCalledTimes(1);
    const payload = mockLogClientError.mock.calls[0]![0];
    expect(payload.message).toBe('boom');
    expect(payload.stack).toBeTruthy();
    expect(payload.stack!.length).toBeGreaterThan(0);
    expect(payload.componentStack).toBeTruthy();
    expect(payload.componentStack!.length).toBeGreaterThan(0);
    expect(typeof payload.timestamp).toBe('number');
  });
});
