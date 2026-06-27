import { memo } from 'react';
import { Shield } from 'lucide-react';

export const CircuitBreakersEmptyState = memo(() => {
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-12 text-center">
      <Shield className="w-16 h-16 text-gray-600 mx-auto mb-4" />
      <h3 className="text-xl font-semibold text-text-base mb-2">No Circuit Breakers Active</h3>
      <p className="text-text-muted">
        Circuit breakers will appear here as servers handle requests and failures occur.
      </p>
    </div>
  );
});

CircuitBreakersEmptyState.displayName = 'CircuitBreakersEmptyState';
