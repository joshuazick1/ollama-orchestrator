import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorBoundary } from '../ErrorBoundary';

const ThrowError = ({ message }: { message: string }) => {
  throw new Error(message);
};

describe('ErrorBoundary', () => {
  let consoleErrorMock: any;

  beforeEach(() => {
    consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock window.location.reload
    Object.defineProperty(window, 'location', {
      value: { reload: vi.fn() },
      writable: true,
    });
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

    // Check reload button
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
});
