export class ProbeCoordinator {
  private probesInProgress: Set<string> = new Set();

  /**
   * Try to acquire a probe lock for a server.
   * Returns true if the probe can proceed, false if another probe is in progress.
   */
  tryAcquire(serverId: string, model?: string): boolean {
    const key = model ? `${serverId}:${model}` : serverId;
    if (this.probesInProgress.has(key)) {
      return false;
    }
    this.probesInProgress.add(key);
    return true;
  }

  /**
   * Release a probe lock for a server.
   */
  release(serverId: string, model?: string): void {
    const key = model ? `${serverId}:${model}` : serverId;
    this.probesInProgress.delete(key);
  }

  /**
   * Check if a probe is currently in progress.
   */
  isInProgress(serverId: string, model?: string): boolean {
    const key = model ? `${serverId}:${model}` : serverId;
    return this.probesInProgress.has(key);
  }

  reset(): void {
    this.probesInProgress.clear();
  }
}

export const probeCoordinator = new ProbeCoordinator();
