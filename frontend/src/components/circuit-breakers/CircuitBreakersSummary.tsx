import { memo } from 'react';
import { ShieldAlert, ShieldQuestion, ShieldCheck } from 'lucide-react';
import type { CircuitBreakerInfo } from '../../api';

interface CircuitBreakersSummaryProps {
  breakers: CircuitBreakerInfo[];
}

export const CircuitBreakersSummary = memo<CircuitBreakersSummaryProps>(({ breakers }) => {
  const openCount = breakers.filter(b => b.state === 'OPEN').length;
  const halfOpenCount = breakers.filter(b => b.state === 'HALF-OPEN').length;
  const closedCount = breakers.filter(b => b.state === 'CLOSED').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-surface rounded-xl border border-red-500/30 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-muted text-sm">Open Circuits</p>
            <p className="text-3xl font-bold text-red-400">{openCount}</p>
          </div>
          <ShieldAlert className="w-12 h-12 text-red-500/50" />
        </div>
        <p className="text-red-400/70 text-sm mt-2">
          {openCount > 0 ? 'Services are being protected' : 'All circuits closed'}
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-yellow-500/30 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-muted text-sm">Half-Open</p>
            <p className="text-3xl font-bold text-yellow-400">{halfOpenCount}</p>
          </div>
          <ShieldQuestion className="w-12 h-12 text-yellow-500/50" />
        </div>
        <p className="text-yellow-400/70 text-sm mt-2">
          {halfOpenCount > 0 ? 'Testing recovery' : 'No circuits testing'}
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-green-500/30 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-text-muted text-sm">Closed Circuits</p>
            <p className="text-3xl font-bold text-green-400">{closedCount}</p>
          </div>
          <ShieldCheck className="w-12 h-12 text-green-500/50" />
        </div>
        <p className="text-green-400/70 text-sm mt-2">Operating normally</p>
      </div>
    </div>
  );
});

CircuitBreakersSummary.displayName = 'CircuitBreakersSummary';
