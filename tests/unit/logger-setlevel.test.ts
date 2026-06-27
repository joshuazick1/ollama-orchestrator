import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '../../src/utils/logger.js';

describe('logger setLevel/getLevel', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DISABLE_FILE_LOGGING = 'true';
    logger.clearLogs();
    logger.setLevel('info');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.DEBUG;
    delete process.env.LOG_LEVEL;
    delete process.env.DISABLE_FILE_LOGGING;
    logger.setLevel('info');
  });

  it('setLevel("debug") makes logger.debug emit when DEBUG=true', () => {
    process.env.DEBUG = 'true';
    logger.setLevel('debug');
    logger.debug('debug message');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: debug message'));
  });

  it('setLevel("info") suppresses logger.debug', () => {
    process.env.DEBUG = 'true';
    logger.setLevel('info');
    logger.debug('debug message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('setLevel("warn") suppresses logger.info', () => {
    logger.setLevel('warn');
    logger.info('info message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('getLevel() returns the current level', () => {
    logger.setLevel('debug');
    expect(logger.getLevel()).toBe('debug');
    logger.setLevel('info');
    expect(logger.getLevel()).toBe('info');
    logger.setLevel('warn');
    expect(logger.getLevel()).toBe('warn');
    logger.setLevel('error');
    expect(logger.getLevel()).toBe('error');
  });

  it('DEBUG=true env gate is respected even after setLevel("debug")', () => {
    logger.setLevel('debug');
    delete process.env.DEBUG;
    logger.debug('should not appear');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
