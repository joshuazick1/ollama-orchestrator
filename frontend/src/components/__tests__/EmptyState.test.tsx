import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  EmptyState,
  LoadingState,
  ErrorState,
  NoServersState,
  NoModelsState,
  NoLogsState,
} from '../EmptyState';

describe('EmptyState Components', () => {
  describe('EmptyState base component', () => {
    it('renders loading state correctly', () => {
      render(<EmptyState type="loading" />);

      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.getByText('Fetching data from the server.')).toBeInTheDocument();
      // Check for spinner icon container if needed
    });

    it('renders empty state correctly', () => {
      render(<EmptyState type="empty" />);

      expect(screen.getByText('No data available')).toBeInTheDocument();
      expect(screen.getByText('There is nothing to display here yet.')).toBeInTheDocument();
    });

    it('overrides default text when props are provided', () => {
      render(<EmptyState type="empty" title="Custom Title" message="Custom Message" />);

      expect(screen.getByText('Custom Title')).toBeInTheDocument();
      expect(screen.getByText('Custom Message')).toBeInTheDocument();
      expect(screen.queryByText('No data available')).not.toBeInTheDocument();
    });

    it('renders action button and handles clicks', () => {
      const onClickMock = vi.fn();
      render(<EmptyState type="empty" action={{ label: 'Click Me', onClick: onClickMock }} />);

      const button = screen.getByRole('button', { name: 'Click Me' });
      expect(button).toBeInTheDocument();

      fireEvent.click(button);
      expect(onClickMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Helper Components', () => {
    it('renders LoadingState', () => {
      render(<LoadingState message="Custom loading..." />);
      expect(screen.getByText('Custom loading...')).toBeInTheDocument();
    });

    it('renders ErrorState', () => {
      render(<ErrorState title="Error!" message="Bad things happened" />);
      expect(screen.getByText('Error!')).toBeInTheDocument();
      expect(screen.getByText('Bad things happened')).toBeInTheDocument();
    });

    it('renders NoServersState with action', () => {
      const onClickMock = vi.fn();
      render(<NoServersState action={{ label: 'Add Server', onClick: onClickMock }} />);

      expect(screen.getByText('No servers configured')).toBeInTheDocument();
      const button = screen.getByRole('button', { name: 'Add Server' });

      fireEvent.click(button);
      expect(onClickMock).toHaveBeenCalledTimes(1);
    });

    it('renders NoModelsState', () => {
      render(<NoModelsState />);
      expect(screen.getByText('No models available')).toBeInTheDocument();
    });

    it('renders NoLogsState', () => {
      render(<NoLogsState />);
      expect(screen.getByText('No logs available')).toBeInTheDocument();
    });
  });
});
