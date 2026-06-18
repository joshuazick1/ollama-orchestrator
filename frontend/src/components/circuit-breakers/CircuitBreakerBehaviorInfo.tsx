import { memo } from 'react';

export const CircuitBreakerBehaviorInfo = memo(() => {
  return (
    <div className="bg-surface rounded-xl border border-surface-border p-6">
      <h3 className="text-lg font-semibold text-text-base mb-4">Circuit Breaker Behavior</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-text-base font-medium mb-2">When does a circuit open?</h4>
          <p className="text-text-muted text-sm">
            A circuit opens when the failure count exceeds the threshold (default: 5 failures) OR
            when the error rate exceeds 50% within the monitoring window (1 minute).
          </p>
        </div>
        <div>
          <h4 className="text-text-base font-medium mb-2">When does a server become unhealthy?</h4>
          <p className="text-text-muted text-sm">
            Servers are marked unhealthy after 3 consecutive transient/retryable failures. Permanent
            errors mark servers unhealthy only if they are server-wide issues (like disk full).
          </p>
        </div>
        <div>
          <h4 className="text-text-base font-medium mb-2">Recovery process</h4>
          <p className="text-text-muted text-sm">
            After 30 seconds (open timeout), the circuit enters half-open state and allows test
            requests. If 3 consecutive requests succeed, the circuit closes.
          </p>
        </div>
        <div>
          <h4 className="text-text-base font-medium mb-2">Server vs Model circuits</h4>
          <p className="text-text-muted text-sm">
            Server-level circuits track overall server health. Model-level circuits track specific
            models on that server (useful for OOM errors affecting only certain models).
          </p>
        </div>
      </div>
    </div>
  );
});

CircuitBreakerBehaviorInfo.displayName = 'CircuitBreakerBehaviorInfo';
