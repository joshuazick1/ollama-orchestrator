export interface OrchestratorErrorClassification {
  isNoServersError: boolean;
  isConcurrencySaturated: boolean;
  isAccessDenied: boolean;
}

export function classifyOrchestratorError(errorMessage: string): OrchestratorErrorClassification {
  const isNoServersError =
    (errorMessage.includes('No') && errorMessage.includes('servers available')) ||
    errorMessage.includes('circuit breaker') ||
    errorMessage.includes('does not support Anthropic');

  const isConcurrencySaturated = errorMessage.includes('at max concurrency');

  const isAccessDenied =
    errorMessage.includes('Access denied') || errorMessage.includes('No servers assigned');

  return {
    isNoServersError,
    isConcurrencySaturated,
    isAccessDenied,
  };
}
