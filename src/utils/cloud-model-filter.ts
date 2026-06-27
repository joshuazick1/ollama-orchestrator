/**
 * Cloud model filter utilities.
 *
 * Identifies cloud-hosted models that require special routing/probing behavior.
 * Patterns (case-insensitive):
 * - `:cloud$` — colon suffix, e.g. "llama3:cloud"
 * - `^cloud-` — cloud prefix with hyphen, e.g. "cloud-gpt4"
 * - `-cloud$` — cloud after hyphen at end, e.g. "meta-cloud"
 */

const CLOUD_PATTERNS = [/:cloud$/i, /^cloud-/i, /-cloud$/i] as const;

export function isCloudModel(name: string): boolean {
  if (!name) {
    return false;
  }
  return CLOUD_PATTERNS.some(pattern => pattern.test(name));
}

export function filterNonCloudModels(models: string[]): string[] {
  return models.filter(model => !isCloudModel(model));
}
