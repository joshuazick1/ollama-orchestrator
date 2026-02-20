import { appendFileSync, mkdirSync } from 'fs';
import { safeJsonStringify } from './json-utils.js';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: unknown;
}

const MAX_LOG_ENTRIES = parseInt(process.env.MAX_LOG_ENTRIES ?? '1000', 10);
const LOG_DIR = process.env.LOG_DIR ?? './logs';
const logBuffer: LogEntry[] = [];

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getLogLevel(): string {
  return process.env.LOG_LEVEL ?? 'info';
}

function shouldLog(level: string): boolean {
  const currentLevel = LOG_LEVELS[getLogLevel() as keyof typeof LOG_LEVELS];
  const msgLevel = LOG_LEVELS[level as keyof typeof LOG_LEVELS];
  return msgLevel >= currentLevel;
}

function addToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift(); // Remove oldest
  }
}

function writeToFile(entry: LogEntry): void {
  if (process.env.DISABLE_FILE_LOGGING === 'true') {
    return;
  }
  try {
    ensureLogDir();
    const logFile = getCurrentLogFile();
    const logLine = safeJsonStringify(entry) + '\n';
    appendFileSync(logFile, logLine);
  } catch (err) {
    // If file logging fails, don't throw - just console.error once?
    console.error('Failed to write to log file:', err);
  }
}

function logToConsole(level: string, message: string, meta?: unknown): void {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  if (meta) {
    if (level === 'error') {
      console.error(prefix, meta);
    } else if (level === 'warn') {
      console.warn(prefix, meta);
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix, meta);
    }
  } else {
    if (level === 'error') {
      console.error(prefix);
    } else if (level === 'warn') {
      console.warn(prefix);
    } else {
      // eslint-disable-next-line no-console
      console.log(prefix);
    }
  }
}

function getCurrentLogFile(): string {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
  return `${LOG_DIR}/app-${dateStr}.log`;
}

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    // Directory might already exist, ignore
  }
}

export const logger = {
  info: (message: string, meta?: unknown): void => {
    if (!shouldLog('info')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level: 'info', message, meta };
    addToBuffer(entry);
    writeToFile(entry);
    logToConsole('info', message, meta);
  },

  warn: (message: string, meta?: unknown): void => {
    if (!shouldLog('warn')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level: 'warn', message, meta };
    addToBuffer(entry);
    writeToFile(entry);
    logToConsole('warn', message, meta);
  },

  error: (message: string, meta?: unknown): void => {
    if (!shouldLog('error')) {
      return;
    }
    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level: 'error', message, meta };
    addToBuffer(entry);
    writeToFile(entry);
    logToConsole('error', message, meta);
  },

  debug: (message: string, meta?: unknown): void => {
    if (process.env.DEBUG !== 'true') {
      return;
    }
    const timestamp = new Date().toISOString();
    const entry: LogEntry = { timestamp, level: 'debug', message, meta };
    addToBuffer(entry);
    writeToFile(entry);
    logToConsole('debug', message, meta);
  },

  getLogs: (limit?: number): LogEntry[] => {
    if (limit) {
      return logBuffer.slice(-limit);
    }
    return [...logBuffer];
  },

  clearLogs: (): void => {
    logBuffer.length = 0;
  },
};
