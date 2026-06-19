export interface OrchestratorErrorClassification {
  isNoServersError: boolean;
  isConcurrencySaturated: boolean;
  isAccessDenied: boolean;
  isModelNotFound: boolean;
}

export function classifyOrchestratorRoutingError(
  errorMessage: string
): OrchestratorErrorClassification {
  const isNoServersError =
    (errorMessage.includes('No') && errorMessage.includes('servers available')) ||
    errorMessage.includes('circuit breaker') ||
    errorMessage.includes('does not support Anthropic');

  const isConcurrencySaturated = errorMessage.includes('at max concurrency');

  const isAccessDenied =
    errorMessage.includes('Access denied') || errorMessage.includes('No servers assigned');

  const isModelNotFound =
    (errorMessage.toLowerCase().includes('model') &&
      errorMessage.toLowerCase().includes('not found')) ||
    errorMessage.toLowerCase().includes('no such model');

  return {
    isNoServersError,
    isConcurrencySaturated,
    isAccessDenied,
    isModelNotFound,
  };
}
