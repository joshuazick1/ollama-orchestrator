/**
 * probe-model-selector.ts
 * Greedy set cover algorithm for selecting probe models that cover all servers.
 * Used by the performance probe subsystem to minimize the number of probe models
 * needed to exercise every server in the fleet.
 */

export interface ModelToServers {
  [model: string]: string[];
}

/**
 * Return servers NOT yet covered by the selected models.
 */
export function getUncoveredServers(
  modelToServers: ModelToServers,
  selectedModels: string[]
): string[] {
  const covered = new Set<string>();
  for (const model of selectedModels) {
    const servers = modelToServers[model];
    if (servers) {
      for (const s of servers) {
        covered.add(s);
      }
    }
  }

  const allServers = new Set<string>();
  for (const servers of Object.values(modelToServers)) {
    for (const s of servers) {
      allServers.add(s);
    }
  }

  const uncovered: string[] = [];
  for (const s of allServers) {
    if (!covered.has(s)) {
      uncovered.push(s);
    }
  }

  return uncovered;
}

/**
 * Greedy set cover: pick the model that covers the most uncovered servers each iteration.
 *
 * Tie-breaker: alphabetically-lower model name wins (deterministic).
 * Stop condition: all servers covered OR maxModels reached.
 *
 * @param modelToServers  Map of model name -> servers that model runs on
 * @param maxModels       Optional cap on number of models to select
 * @returns Selected model names in selection order
 */
export function selectProbeModels(modelToServers: ModelToServers, maxModels?: number): string[] {
  const selected: string[] = [];
  const covered = new Set<string>();
  const allServers = new Set<string>();

  for (const servers of Object.values(modelToServers)) {
    for (const s of servers) {
      allServers.add(s);
    }
  }

  // Nothing to cover
  if (allServers.size === 0) {
    return selected;
  }

  while (covered.size < allServers.size) {
    if (maxModels !== undefined && selected.length >= maxModels) {
      break;
    }

    let bestModel: string | null = null;
    let bestNewCoverage = 0;

    for (const [model, servers] of Object.entries(modelToServers)) {
      if (selected.includes(model)) {
        continue;
      }

      const newCoverage = servers.filter(s => !covered.has(s)).length;

      if (
        newCoverage > bestNewCoverage ||
        (newCoverage === bestNewCoverage && bestModel !== null && model < bestModel)
      ) {
        bestModel = model;
        bestNewCoverage = newCoverage;
      }
    }

    if (bestModel === null || bestNewCoverage === 0) {
      break;
    }

    selected.push(bestModel);
    for (const s of modelToServers[bestModel]!) {
      covered.add(s);
    }
  }

  return selected;
}
