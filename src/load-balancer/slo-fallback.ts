export interface SLOFallbackConfig {
  enabled: boolean;
  ttftThresholdMs: number;
  p95WindowMs: number;
}

export class SLOFallbackMonitor {
  private entries: Array<{ timestamp: number; p95: number }> = [];
  private mode: 'normal' | 'fallback' = 'normal';
  private triggeredAt?: number;
  private readonly windowMs: number;
  private readonly thresholdMs: number;
  private readonly enabled: boolean;

  constructor(config: SLOFallbackConfig) {
    this.enabled = config.enabled;
    this.thresholdMs = config.ttftThresholdMs;
    this.windowMs = config.p95WindowMs;
  }

  update(ttftP95PerServer: Record<string, number>): void {
    if (!this.enabled) {
      this.mode = 'normal';
      this.triggeredAt = undefined;
      return;
    }

    const values = Object.values(ttftP95PerServer);
    if (values.length === 0) {
      return;
    }

    const avgP95 = values.reduce((s, v) => s + v, 0) / values.length;
    const now = Date.now();

    this.entries.push({ timestamp: now, p95: avgP95 });

    const cutoff = now - this.windowMs;
    this.entries = this.entries.filter(e => e.timestamp >= cutoff);

    if (this.entries.length < 3) {
      return;
    }

    const allExceedThreshold = this.entries.every(e => e.p95 > this.thresholdMs);
    const allBelowThreshold = this.entries.every(e => e.p95 <= this.thresholdMs);

    if (allExceedThreshold) {
      if (this.mode === 'normal') {
        this.mode = 'fallback';
        this.triggeredAt = now;
      }
    } else if (allBelowThreshold) {
      if (this.mode === 'fallback') {
        this.mode = 'normal';
        this.triggeredAt = undefined;
      }
    }
  }

  isActive(): boolean {
    return this.mode === 'fallback';
  }

  getMode(): 'normal' | 'fallback' {
    return this.mode;
  }
}
