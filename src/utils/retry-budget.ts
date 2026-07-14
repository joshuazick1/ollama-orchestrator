/**
 * retry-budget.ts
 * Tracks total retry attempts per request to prevent runaway retry loops
 */

export class RetryBudget {
  private attemptsUsed: number = 0;
  private maxAttempts: number;
  private serverAttempts: Map<string, number> = new Map();

  constructor(maxAttempts: number = 10) {
    this.maxAttempts = maxAttempts;
  }

  /**
   * Returns true if budget not exhausted and more retries are allowed
   */
  canRetry(): boolean {
    return this.attemptsUsed < this.maxAttempts;
  }

  /**
   * Records an attempt against the budget and tracks per-server attempts.
   * When `latencyMs` is provided and the attempt completed in under 1 s,
   * the attempt is tracked per-server but does NOT consume budget
   * (fast failures are typically unreachable servers — counting them
   * would exhaust the budget before slower-to-respond servers are tried).
   */
  recordAttempt(serverId: string, latencyMs?: number): void {
    this.serverAttempts.set(serverId, (this.serverAttempts.get(serverId) ?? 0) + 1);
    if (latencyMs !== undefined && latencyMs < 1000) return;
    this.attemptsUsed++;
  }

  /**
   * Returns total attempts used
   */
  getAttemptsUsed(): number {
    return this.attemptsUsed;
  }

  /**
   * Returns remaining attempts (minimum 0)
   */
  getAttemptsRemaining(): number {
    return Math.max(0, this.maxAttempts - this.attemptsUsed);
  }

  /**
   * Returns attempts used for a specific server
   */
  getServerAttempts(serverId: string): number {
    return this.serverAttempts.get(serverId) ?? 0;
  }

  /**
   * Returns true if no attempts remaining
   */
  isExhausted(): boolean {
    return this.attemptsUsed >= this.maxAttempts;
  }

  /**
   * Resets budget for reuse (for subsequent requests)
   */
  reset(): void {
    this.attemptsUsed = 0;
    this.serverAttempts.clear();
  }
}
