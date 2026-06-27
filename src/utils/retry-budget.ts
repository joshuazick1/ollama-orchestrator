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
   * Records an attempt against the budget and tracks per-server attempts
   */
  recordAttempt(serverId: string): void {
    this.attemptsUsed++;
    const current = this.serverAttempts.get(serverId) ?? 0;
    this.serverAttempts.set(serverId, current + 1);
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
