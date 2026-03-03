import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  formatDurationMs,
  formatDurationShort,
  formatBytes,
  formatNumber,
  formatPercentage,
} from '../formatting';

describe('formatDuration', () => {
  it('formats milliseconds under 1000', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDuration(1000)).toBe('1s');
    expect(formatDuration(5500)).toBe('5s');
    expect(formatDuration(59999)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3661000)).toBe('61m 1s');
  });

  it('handles edge cases', () => {
    expect(formatDuration(-1)).toBe('-1ms');
    expect(formatDuration(NaN)).toBe('NaNms');
  });
});

describe('formatDurationMs', () => {
  it('formats milliseconds under 1000', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(500)).toBe('500ms');
    expect(formatDurationMs(999)).toBe('999ms');
  });

  it('formats seconds with 2 decimals', () => {
    expect(formatDurationMs(1000)).toBe('1.00s');
    expect(formatDurationMs(1500)).toBe('1.50s');
    expect(formatDurationMs(10000)).toBe('10.00s');
  });

  it('handles edge cases', () => {
    expect(formatDurationMs(NaN)).toBe('NaNms');
  });
});

describe('formatDurationShort', () => {
  it('formats milliseconds', () => {
    expect(formatDurationShort(0)).toBe('0ms');
    expect(formatDurationShort(500)).toBe('500ms');
    expect(formatDurationShort(999)).toBe('999ms');
  });

  it('formats seconds', () => {
    expect(formatDurationShort(1000)).toBe('1s');
    expect(formatDurationShort(59000)).toBe('59s');
  });

  it('formats minutes', () => {
    expect(formatDurationShort(60000)).toBe('1m');
    expect(formatDurationShort(3600000)).toBe('1h 0m');
    expect(formatDurationShort(3660000)).toBe('1h 1m');
  });

  it('formats hours', () => {
    expect(formatDurationShort(3600000)).toBe('1h 0m');
    expect(formatDurationShort(7200000)).toBe('2h 0m');
  });
});

describe('formatBytes', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('-');
    expect(formatBytes(undefined)).toBe('-');
    expect(formatBytes(500)).toBe('500.00 B');
    expect(formatBytes(1023)).toBe('1023.00 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(1572864)).toBe('1.50 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1073741824)).toBe('1.00 GB');
  });
});

describe('formatNumber', () => {
  it('formats thousands', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(500)).toBe('500');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(999999)).toBe('1000.0K');
  });

  it('formats millions', () => {
    expect(formatNumber(1000000)).toBe('1.0M');
    expect(formatNumber(2500000)).toBe('2.5M');
  });
});

describe('formatPercentage', () => {
  it('formats percentages', () => {
    expect(formatPercentage(0)).toBe('0.0%');
    expect(formatPercentage(0.5)).toBe('50.0%');
    expect(formatPercentage(1)).toBe('100.0%');
    expect(formatPercentage(0.123)).toBe('12.3%');
  });

  it('respects decimal parameter', () => {
    expect(formatPercentage(0.1234, 0)).toBe('12%');
    expect(formatPercentage(0.1234, 2)).toBe('12.34%');
    expect(formatPercentage(0.1234, 4)).toBe('12.3400%');
  });
});
