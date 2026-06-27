import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { Button as UiButton } from './ui/button';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

type ShadcnVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
type ShadcnSize = 'default' | 'sm' | 'lg' | 'icon';

const variantMap: Record<NonNullable<ButtonProps['variant']>, ShadcnVariant> = {
  primary: 'default',
  secondary: 'secondary',
  danger: 'destructive',
  ghost: 'ghost',
};

const sizeMap: Record<NonNullable<ButtonProps['size']>, ShadcnSize> = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <UiButton
      type={type}
      disabled={isDisabled}
      variant={variantMap[variant]}
      size={sizeMap[size]}
      className={className}
      {...props}
    >
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </UiButton>
  );
}

export default Button;
