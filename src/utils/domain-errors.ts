/**
 * domain-errors.ts
 * Domain-specific error classes for the Ollama Orchestrator.
 *
 * Each class carries an HTTP status code so the global error handler can
 * derive the response without a switch/case on error names.
 *
 * Audit: E-4
 */

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

/**
 * Base error for all orchestrator domain errors.
 * Captures an HTTP status code and an optional machine-readable `code` field
 * suitable for RFC 7807 `type` values.
 */
export class OrchestratorError extends Error {
  constructor(
    message: string,
    public readonly status: number = 500,
    public readonly code: string = 'orchestrator_error'
  ) {
    super(message);
    this.name = 'OrchestratorError';
  }
}

// ---------------------------------------------------------------------------
// 4xx — Client errors
// ---------------------------------------------------------------------------

/** A referenced server does not exist. */
export class ServerNotFoundError extends OrchestratorError {
  constructor(id: string) {
    super(`Server '${id}' not found`, 404, 'server_not_found');
    this.name = 'ServerNotFoundError';
  }
}

/** A referenced model is not available on any healthy server. */
export class ModelNotFoundError extends OrchestratorError {
  constructor(model: string) {
    super(`Model '${model}' not found on any healthy server`, 404, 'model_not_found');
    this.name = 'ModelNotFoundError';
  }
}

/** Required request parameters are missing or invalid. */
export class ValidationError extends OrchestratorError {
  constructor(message: string) {
    super(message, 400, 'validation_error');
    this.name = 'ValidationError';
  }
}

/** A resource that should be unique already exists (e.g. duplicate server). */
export class ConflictError extends OrchestratorError {
  constructor(message: string) {
    super(message, 409, 'conflict');
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// 5xx — Server / infrastructure errors
// ---------------------------------------------------------------------------

/** The target Ollama server is unreachable or returned a non-OK status. */
export class ServerUnavailableError extends OrchestratorError {
  constructor(id: string, reason?: string) {
    super(
      reason ? `Server '${id}' unavailable: ${reason}` : `Server '${id}' is not healthy`,
      503,
      'server_unavailable'
    );
    this.name = 'ServerUnavailableError';
  }
}

/** The circuit breaker for a server:model pair is open. */
export class CircuitBreakerOpenError extends OrchestratorError {
  constructor(serverId: string, model: string) {
    super(`Circuit breaker is open for ${serverId}:${model}`, 503, 'circuit_breaker_open');
    this.name = 'CircuitBreakerOpenError';
  }
}

/** A downstream request exceeded its timeout budget. */
export class TimeoutError extends OrchestratorError {
  constructor(message: string) {
    super(message, 504, 'timeout');
    this.name = 'TimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Type guard for any OrchestratorError subclass.
 */
export function isOrchestratorError(error: unknown): error is OrchestratorError {
  return error instanceof OrchestratorError;
}
