/**
 * Formatting utilities for consistent display across the application
 */

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};

export const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatDurationShort = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
};

export const formatTimeAgo = (timestamp: number): string => {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
};

export const formatTimeUntil = (timestamp: number): string => {
  if (!timestamp || timestamp <= Date.now()) return 'Now';
  const seconds = Math.floor((timestamp - Date.now()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export const formatDate = (dateStr?: string): string => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '-';
  }
};

export const formatDateTime = (dateStr?: string): string => {
  if (!dateStr) return '-';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '-';
  }
};

export const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '-';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
};

export const formatNumber = (num: number): string => {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toLocaleString();
};

export const formatPercentage = (value: number, decimals = 1): string => {
  return `${(value * 100).toFixed(decimals)}%`;
};

export const formatLatency = (ms: number): string => {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const formatThroughput = (requestsPerSecond: number): string => {
  if (requestsPerSecond < 1) {
    return `${(requestsPerSecond * 60).toFixed(1)}/min`;
  }
  return `${requestsPerSecond.toFixed(1)}/s`;
};

export const formatRelativeTime = (
  timestamp: number,
  options?: {
    short?: boolean;
    suffix?: boolean;
  }
): string => {
  if (!timestamp) return '-';

  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  const short = options?.short ?? false;
  const suffix = options?.suffix ?? true;

  let value: number;
  let unit: string;

  if (seconds < 60) {
    value = seconds;
    unit = short ? 's' : 'second';
  } else if (seconds < 3600) {
    value = Math.floor(seconds / 60);
    unit = short ? 'm' : 'minute';
  } else if (seconds < 86400) {
    value = Math.floor(seconds / 3600);
    unit = short ? 'h' : 'hour';
  } else {
    value = Math.floor(seconds / 86400);
    unit = short ? 'd' : 'day';
  }

  const suffixStr = suffix ? (value === 1 ? (short ? '' : ' ago') : short ? '' : ' ago') : '';
  const plural = value !== 1 && !short ? 's' : '';

  return `${value}${unit}${plural}${suffixStr}`;
};
