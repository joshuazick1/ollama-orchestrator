import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../button';

describe('Button component', () => {
  it('renders with default variant', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('renders with different variants', () => {
    const variants = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;
    variants.forEach(variant => {
      const { container } = render(<Button variant={variant}>Button</Button>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  it('renders with different sizes', () => {
    const sizes = ['default', 'sm', 'lg', 'icon'] as const;
    sizes.forEach(size => {
      const { container } = render(<Button size={size}>Button</Button>);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  it('forwards ref to button element', () => {
    const ref = { current: null } as React.RefObject<HTMLButtonElement>;
    render(<Button ref={ref}>Button</Button>);
    expect(ref.current).not.toBeNull();
  });

  it('applies disabled state', () => {
    render(<Button disabled>Disabled Button</Button>);
    expect(screen.getByRole('button', { name: 'Disabled Button' })).toBeDisabled();
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    screen.getByRole('button', { name: 'Click me' }).click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
