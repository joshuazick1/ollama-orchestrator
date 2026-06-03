/**
 * domain-errors.test.ts
 * Tests for domain-specific error classes
 */

import { describe, it, expect } from 'vitest';

import {
  OrchestratorError,
  ServerNotFoundError,
  ModelNotFoundError,
  ValidationError,
  ConflictError,
  ServerUnavailableError,
  CircuitBreakerOpenError,
  TimeoutError,
  isOrchestratorError,
} from '../../src/utils/domain-errors.js';

describe('OrchestratorError', () => {
  it('should have correct default values', () => {
    const error = new OrchestratorError('test message');

    expect(error.message).toBe('test message');
    expect(error.status).toBe(500);
    expect(error.code).toBe('orchestrator_error');
    expect(error.name).toBe('OrchestratorError');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(OrchestratorError);
  });

  it('should accept custom status and code', () => {
    const error = new OrchestratorError('custom error', 418, 'teapot');

    expect(error.message).toBe('custom error');
    expect(error.status).toBe(418);
    expect(error.code).toBe('teapot');
    expect(error.name).toBe('OrchestratorError');
  });

  it('should have stack trace', () => {
    const error = new OrchestratorError('test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('OrchestratorError');
  });
});

describe('ServerNotFoundError', () => {
  it('should have correct message format', () => {
    const error = new ServerNotFoundError('server-1');

    expect(error.message).toBe("Server 'server-1' not found");
    expect(error.status).toBe(404);
    expect(error.code).toBe('server_not_found');
    expect(error.name).toBe('ServerNotFoundError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle special characters in id', () => {
    const error = new ServerNotFoundError('server:with:colons');
    expect(error.message).toBe("Server 'server:with:colons' not found");
  });

  it('should handle empty string id', () => {
    const error = new ServerNotFoundError('');
    expect(error.message).toBe("Server '' not found");
  });
});

describe('ModelNotFoundError', () => {
  it('should have correct message format', () => {
    const error = new ModelNotFoundError('llama3');

    expect(error.message).toBe("Model 'llama3' not found on any healthy server");
    expect(error.status).toBe(404);
    expect(error.code).toBe('model_not_found');
    expect(error.name).toBe('ModelNotFoundError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle model names with special characters', () => {
    const error = new ModelNotFoundError('model/version');
    expect(error.message).toBe("Model 'model/version' not found on any healthy server");
  });
});

describe('ValidationError', () => {
  it('should have correct values', () => {
    const error = new ValidationError('Field x is required');

    expect(error.message).toBe('Field x is required');
    expect(error.status).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle empty message', () => {
    const error = new ValidationError('');
    expect(error.message).toBe('');
  });
});

describe('ConflictError', () => {
  it('should have correct values', () => {
    const error = new ConflictError('Server already exists');

    expect(error.message).toBe('Server already exists');
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
    expect(error.name).toBe('ConflictError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ServerUnavailableError', () => {
  it('should have correct values without reason', () => {
    const error = new ServerUnavailableError('server-1');

    expect(error.message).toBe("Server 'server-1' is not healthy");
    expect(error.status).toBe(503);
    expect(error.code).toBe('server_unavailable');
    expect(error.name).toBe('ServerUnavailableError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should include reason when provided', () => {
    const error = new ServerUnavailableError('server-1', 'connection refused');

    expect(error.message).toBe("Server 'server-1' unavailable: connection refused");
  });

  it('should handle empty reason string (treated as falsy, uses default message)', () => {
    const error = new ServerUnavailableError('server-1', '');
    expect(error.message).toBe("Server 'server-1' is not healthy");
  });

  it('should handle undefined reason', () => {
    const error = new ServerUnavailableError('server-1', undefined);
    expect(error.message).toBe("Server 'server-1' is not healthy");
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should have correct message format', () => {
    const error = new CircuitBreakerOpenError('server-1', 'llama3');

    expect(error.message).toBe('Circuit breaker is open for server-1:llama3');
    expect(error.status).toBe(503);
    expect(error.code).toBe('circuit_breaker_open');
    expect(error.name).toBe('CircuitBreakerOpenError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle serverId and model with special characters', () => {
    const error = new CircuitBreakerOpenError('s:1', 'm:v');
    expect(error.message).toBe('Circuit breaker is open for s:1:m:v');
  });
});

describe('TimeoutError', () => {
  it('should have correct values', () => {
    const error = new TimeoutError('Request timed out after 30s');

    expect(error.message).toBe('Request timed out after 30s');
    expect(error.status).toBe(504);
    expect(error.code).toBe('timeout');
    expect(error.name).toBe('TimeoutError');
    expect(error).toBeInstanceOf(OrchestratorError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should handle generic timeout message', () => {
    const error = new TimeoutError('timeout');
    expect(error.message).toBe('timeout');
  });
});

describe('isOrchestratorError', () => {
  it('should return true for OrchestratorError', () => {
    const error = new OrchestratorError('test');
    expect(isOrchestratorError(error)).toBe(true);
  });

  it('should return true for subclass instances', () => {
    expect(isOrchestratorError(new ServerNotFoundError('x'))).toBe(true);
    expect(isOrchestratorError(new ModelNotFoundError('x'))).toBe(true);
    expect(isOrchestratorError(new ValidationError('x'))).toBe(true);
    expect(isOrchestratorError(new ConflictError('x'))).toBe(true);
    expect(isOrchestratorError(new ServerUnavailableError('x'))).toBe(true);
    expect(isOrchestratorError(new CircuitBreakerOpenError('x', 'y'))).toBe(true);
    expect(isOrchestratorError(new TimeoutError('x'))).toBe(true);
  });

  it('should return false for plain Error', () => {
    expect(isOrchestratorError(new Error('plain error'))).toBe(false);
  });

  it('should return false for non-Error values', () => {
    expect(isOrchestratorError('string')).toBe(false);
    expect(isOrchestratorError(null)).toBe(false);
    expect(isOrchestratorError(undefined)).toBe(false);
    expect(isOrchestratorError({ message: 'test' })).toBe(false);
    expect(isOrchestratorError({})).toBe(false);
  });

  it('should return false for objects with error-like shape but not instance of OrchestratorError', () => {
    const fakeError = {
      name: 'FakeError',
      message: 'not a real error',
      status: 500,
      code: 'fake',
    };
    expect(isOrchestratorError(fakeError)).toBe(false);
  });
});

describe('error class hierarchy', () => {
  it('should all extend from Error', () => {
    const errors = [
      new OrchestratorError('test'),
      new ServerNotFoundError('test'),
      new ModelNotFoundError('test'),
      new ValidationError('test'),
      new ConflictError('test'),
      new ServerUnavailableError('test'),
      new CircuitBreakerOpenError('test', 'model'),
      new TimeoutError('test'),
    ];

    errors.forEach(error => {
      expect(error).toBeInstanceOf(Error);
    });
  });

  it('should all extend from OrchestratorError', () => {
    const errors = [
      new ServerNotFoundError('test'),
      new ModelNotFoundError('test'),
      new ValidationError('test'),
      new ConflictError('test'),
      new ServerUnavailableError('test'),
      new CircuitBreakerOpenError('test', 'model'),
      new TimeoutError('test'),
    ];

    errors.forEach(error => {
      expect(error).toBeInstanceOf(OrchestratorError);
    });
  });
});

describe('error properties', () => {
  it('should have all required properties on OrchestratorError', () => {
    const error = new OrchestratorError('test', 400, 'test_code');

    expect(error).toHaveProperty('message');
    expect(error).toHaveProperty('status');
    expect(error).toHaveProperty('code');
    expect(error).toHaveProperty('name');
    expect(error).toHaveProperty('stack');
  });

  it('should have correct property types', () => {
    const error = new ServerNotFoundError('test-id');

    expect(typeof error.message).toBe('string');
    expect(typeof error.status).toBe('number');
    expect(typeof error.code).toBe('string');
    expect(typeof error.name).toBe('string');
    expect(typeof error.stack).toBe('string');
  });
});
