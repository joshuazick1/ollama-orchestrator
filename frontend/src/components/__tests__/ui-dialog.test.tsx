import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';

const DialogTestWrapper = ({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;
  const handleOpenChange = isControlled ? onOpenChange! : setUncontrolledOpen;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button>Open Dialog</button>
      </DialogTrigger>
      <DialogContent data-testid="dialog-content">
        <DialogHeader>
          <DialogTitle>Test Title</DialogTitle>
          <DialogDescription>Test Description</DialogDescription>
        </DialogHeader>
        <div>Dialog body content</div>
        <DialogFooter>
          <button onClick={() => handleOpenChange(false)}>Cancel</button>
          <button>Confirm</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

describe('Dialog component', () => {
  it('does not render when closed', () => {
    render(<DialogTestWrapper open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders when opened', () => {
    render(<DialogTestWrapper open={true} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
    expect(screen.getByText('Dialog body content')).toBeInTheDocument();
  });

  it('opens when trigger is clicked (uncontrolled)', () => {
    render(<DialogTestWrapper />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Dialog' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes when close button is clicked', () => {
    render(<DialogTestWrapper open={true} />);
    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes when cancel button in footer is clicked', () => {
    render(<DialogTestWrapper open={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirm button does not close dialog', () => {
    render(<DialogTestWrapper open={true} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has DialogHeader with title and description', () => {
    render(<DialogTestWrapper open={true} />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Description')).toBeInTheDocument();
  });
});
