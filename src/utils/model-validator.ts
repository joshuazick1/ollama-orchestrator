const SUSPICIOUS_PATTERNS = [
  /^https?:\/\//i,
  /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  /^[a-f0-9]{32,}$/i,
  /attack/i,
  /leak/i,
  /malware/i,
  /virus/i,
  /exploit/i,
  /:cloud$/i,
  /^cloud-/i,
  /^-cloud/i,
  /phish/i,
  /\.(exe|bat|cmd|ps1|sh|dll)$/i,
];

export function isValidModelName(name: string): boolean {
  if (!name || name.length < 1 || name.length > 200) {
    return false;
  }
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(name)) {
      return false;
    }
  }
  return true;
}

export function filterValidModels(models: string[]): string[] {
  return models.filter(isValidModelName);
}
