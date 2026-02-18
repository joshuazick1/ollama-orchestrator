import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { clsx } from 'clsx';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
  animation?: 'fade' | 'slide-left' | 'slide-right' | 'scale' | 'slide-up';
  delay?: number;
}

export const PageTransition = ({
  children,
  className,
  animation = 'fade',
  delay = 0,
}: PageTransitionProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timeout);
  }, [delay]);

  const animationClasses = {
    fade: 'animate-fade-in',
    'slide-left': 'animate-slide-in-left',
    'slide-right': 'animate-slide-in-right',
    scale: 'animate-scale-in',
    'slide-up': 'animate-slide-up',
  };

  return (
    <div
      className={clsx(
        'transition-opacity duration-300',
        isVisible ? 'opacity-100' : 'opacity-0',
        animationClasses[animation],
        className
      )}
    >
      {children}
    </div>
  );
};

interface StaggeredListProps {
  children: ReactNode;
  className?: string;
  staggerDelay?: number;
}

export const StaggeredList = ({ children, className, staggerDelay = 50 }: StaggeredListProps) => {
  const childrenArray = Array.isArray(children) ? children : [children];

  return (
    <div className={className}>
      {childrenArray.map((child, index) => (
        <div
          key={index}
          className="animate-slide-up"
          style={{ animationDelay: `${index * staggerDelay}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  );
};

interface AnimatedCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  onClick?: () => void;
}

export const AnimatedCard = ({ children, className, delay = 0, onClick }: AnimatedCardProps) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timeout);
  }, [delay]);

  return (
    <div
      onClick={onClick}
      className={clsx(
        'transition-all duration-300',
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4',
        onClick && 'cursor-pointer hover:shadow-lg hover:scale-[1.01]',
        className
      )}
    >
      {children}
    </div>
  );
};

export const AnimatedNumber = ({
  value,
  duration = 1000,
  className,
}: {
  value: number;
  duration?: number;
  className?: string;
}) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTime: number;
    const startValue = 0;
    const endValue = value;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.floor(startValue + (endValue - startValue) * easeOut));

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };

    requestAnimationFrame(animate);
  }, [value, duration]);

  return <span className={className}>{displayValue.toLocaleString()}</span>;
};
