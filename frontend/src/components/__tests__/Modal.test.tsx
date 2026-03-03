import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Modal } from '../Modal';

vi.mock('focus-trap', () => ({
  createFocusTrap: vi.fn(() => ({
    activate: vi.fn(),
    deactivate: vi.fn(),
  })),
}));

describe('Modal component', () => {
  it('does not render if not open', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.queryByText('Test Modal')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal Content')).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    // Get the overlay by finding the parent div of the dialog
    // In our component, it's the fixed wrapper with the z-index
    const modalContent = screen.getByRole('dialog');
    const overlay = modalContent.parentElement!;

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onClose when modal content is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    const closeButton = screen.getByRole('button', { name: 'Close modal' });
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test Modal">
        <div>Modal Content</div>
      </Modal>
    );

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders footer if provided', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal" footer={<button>Confirm</button>}>
        <div>Modal Content</div>
      </Modal>
    );

    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('does not render close button when showCloseButton is false', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal" showCloseButton={false}>
        <div>Modal Content</div>
      </Modal>
    );

    expect(screen.queryByRole('button', { name: 'Close modal' })).not.toBeInTheDocument();
  });
});
