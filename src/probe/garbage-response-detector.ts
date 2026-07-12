/**
 * garbage-response-detector.ts
 * Pure function for detecting upstream model responses that are clearly "garbage" —
 * meaning the model or proxy is corrupted or hallucinating nonsense.
 * NO state, NO time math, NO I/O.
 *
 * Quarantine reason (for wiring agent): 'garbage-response'
 */

export type GarbageSignal =
  | 'cjk-overrun'            // >X% of non-whitespace chars are CJK when prompt was non-CJK
  | 'high-profanity'         // >Y% of tokens match a small profanity/stop-word list
  | 'repetition-loop'        // any 4-gram repeats >=3 times within the response
  | 'mostly-control-chars'   // >Z% control/non-printable chars
  | 'near-empty'             // <N non-whitespace chars
  | 'token-storm';           // response is way longer than expected for prompt size (5x+)

export interface GarbageDetection {
  isGarbage: boolean;
  signals: GarbageSignal[];
  confidence: number;       // 0..1, sum of weights / max possible
  evidence: string | null;  // short snippet (first 200 chars) for ops debug
}

export interface GarbageDetectorConfig {
  cjkThreshold?: number;          // default 0.6
  profanityThreshold?: number;    // default 0.15
  repetitionNgram?: number;       // default 4
  repetitionCount?: number;       // default 3
  controlCharThreshold?: number;  // default 0.1
  minCharsForAnalysis?: number;   // default 20
  tokenStormRatio?: number;       // default 5
}

export const DEFAULT_GARBAGE_DETECTOR_CONFIG: GarbageDetectorConfig = {
  cjkThreshold: 0.6,
  profanityThreshold: 0.15,
  repetitionNgram: 4,
  repetitionCount: 3,
  controlCharThreshold: 0.1,
  minCharsForAnalysis: 20,
  tokenStormRatio: 5,
};

/** Weights for each signal, used to compute weighted confidence */
const SIGNAL_WEIGHTS: Record<GarbageSignal, number> = {
  'cjk-overrun': 0.4,
  'high-profanity': 0.3,
  'repetition-loop': 0.4,
  'mostly-control-chars': 0.5,
  'near-empty': 0.2,
  'token-storm': 0.2,
};

const MAX_CONFIDENCE = Object.values(SIGNAL_WEIGHTS).reduce((a, b) => a + b, 0); // 2.0

/**
 * A small embedded stop-word list for high-profanity detection.
 * Covers well-known English profanity tokens (whole-word, case-insensitive match).
 */
const PROFANITY_TOKENS = new Set([
  'fuck',
  'fucking',
  'fucked',
  'fucker',
  'shit',
  'shitting',
  'shitty',
  'bitch',
  'bitching',
  'ass',
  'asshole',
  'damn',
  'damned',
  'hell',
  'cock',
  'cunt',
  'dick',
  'pussy',
  'whore',
  'slut',
  'bullshit',
]);

/**
 * Check if a code point is a CJK Unified Ideographs character.
 */
function isCjk(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||   // CJK Unified Ideographs
    (cp >= 0x3400 && cp <= 0x4dbf) ||   // CJK Unified Ideographs Extension A
    (cp >= 0x20000 && cp <= 0x2a6df) || // CJK Unified Ideographs Extension B
    (cp >= 0x2a700 && cp <= 0x2b73f) || // CJK Unified Ideographs Extension C
    (cp >= 0x2b740 && cp <= 0x2b81f) || // CJK Unified Ideographs Extension D
    (cp >= 0x3000 && cp <= 0x303f) ||   // CJK Symbols and Punctuation
    (cp >= 0xf900 && cp <= 0xfaff) ||   // CJK Compatibility Ideographs
    (cp >= 0x2f800 && cp <= 0x2fa1f)    // CJK Compatibility Ideographs Supplement
  );
}

/**
 * Compute the ratio of CJK characters among all non-whitespace characters.
 * Returns 0 if there are no non-whitespace characters.
 */
function cjkRatio(text: string): number {
  let total = 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (!/\s/.test(ch)) {
      total++;
      if (isCjk(cp)) {
        cjk++;
      }
    }
  }
  return total === 0 ? 0 : cjk / total;
}

/**
 * Check if the prompt appears to be primarily Latin/non-CJK.
 * Returns true when Latin alphabet density > 70%.
 */
function isNonCjkPrompt(promptText: string): boolean {
  let total = 0;
  let latin = 0;
  for (const ch of promptText) {
    const cp = ch.codePointAt(0)!;
    if (!/\s/.test(ch)) {
      total++;
      // Latin alphabet letters (A-Z, a-z)
      if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122)) {
        latin++;
      }
    }
  }
  return total > 0 && latin / total > 0.7;
}

/**
 * Tokenise text into words (whitespace-delimited tokens, lowercased).
 * Filters out empty tokens.
 */
function tokenise(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(t => t.length > 0);
}

/**
 * Compute the ratio of profanity tokens to total word tokens.
 */
function profanityRatio(text: string): number {
  const tokens = tokenise(text);
  if (tokens.length === 0) {
    return 0;
  }
  let profane = 0;
  for (const token of tokens) {
    // Strip leading/trailing punctuation for whole-word matching
    const cleaned = token.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
    if (cleaned.length > 0 && PROFANITY_TOKENS.has(cleaned)) {
      profane++;
    }
  }
  return profane / tokens.length;
}

/**
 * Build n-grams of the given size from an array of tokens.
 */
function buildNgrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) {
    return [];
  }
  const result: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    result.push(tokens.slice(i, i + n).join(' '));
  }
  return result;
}

/**
 * Check for repetition loops: any n-gram appears >= count times.
 */
function hasRepetitionLoop(text: string, ngramSize: number, minCount: number): boolean {
  const tokens = tokenise(text);
  const ngrams = buildNgrams(tokens, ngramSize);
  if (ngrams.length === 0) {
    return false;
  }
  const freq = new Map<string, number>();
  for (const ng of ngrams) {
    freq.set(ng, (freq.get(ng) ?? 0) + 1);
  }
  for (const count of freq.values()) {
    if (count >= minCount) {
      return true;
    }
  }
  return false;
}

/**
 * Ratio of control/non-printable characters (charCode < 0x20 but not common whitespace,
 * or in 0x7F-0x9F range) among all characters.
 */
function controlCharRatio(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let control = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const isCommonWhitespace = cp === 0x09 || cp === 0x0a || cp === 0x0d; // \t \n \r
    if (!isCommonWhitespace) {
      if (cp < 0x20) {
        control++;
      } else if (cp >= 0x7f && cp <= 0x9f) {
        control++;
      }
    }
  }
  return control / text.length;
}

/**
 * Non-whitespace character count.
 */
function nonWhitespaceCount(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * Detect garbage signals in a response.
 *
 * Decision rule: isGarbage = signals.length >= 2.
 * Two or more independent signals firing is a strong corruption indicator.
 * Single signals are too risky for false positives.
 *
 * @param responseText  The raw model response text
 * @param promptText    The prompt that generated the response (null if unavailable)
 * @param config        Optional configuration overrides
 * @returns GarbageDetection result
 */
export function detectGarbageResponse(
  responseText: string,
  promptText: string | null,
  config?: GarbageDetectorConfig
): GarbageDetection {
  const cfg = { ...DEFAULT_GARBAGE_DETECTOR_CONFIG, ...config };

  const signals: GarbageSignal[] = [];
  let weightSum = 0;

  const trimmedResponse = responseText.trim();
  const evidence = trimmedResponse.length > 200 ? trimmedResponse.slice(0, 200) : trimmedResponse;

  // 1. cjk-overrun — only when prompt is provided and is clearly non-CJK
  if (promptText !== null && isNonCjkPrompt(promptText)) {
    if (cjkRatio(trimmedResponse) > cfg.cjkThreshold!) {
      signals.push('cjk-overrun');
      weightSum += SIGNAL_WEIGHTS['cjk-overrun'];
    }
  }

  // 2. high-profanity — ratio of profanity tokens exceeds threshold
  if (profanityRatio(trimmedResponse) > cfg.profanityThreshold!) {
    signals.push('high-profanity');
    weightSum += SIGNAL_WEIGHTS['high-profanity'];
  }

  // 3. repetition-loop — any n-gram repeats >= repetitionCount times
  if (hasRepetitionLoop(trimmedResponse, cfg.repetitionNgram!, cfg.repetitionCount!)) {
    signals.push('repetition-loop');
    weightSum += SIGNAL_WEIGHTS['repetition-loop'];
  }

  // 4. mostly-control-chars — ratio of control chars exceeds threshold
  if (controlCharRatio(trimmedResponse) > cfg.controlCharThreshold!) {
    signals.push('mostly-control-chars');
    weightSum += SIGNAL_WEIGHTS['mostly-control-chars'];
  }

  // 5. near-empty — fewer than minCharsForAnalysis non-whitespace chars
  if (nonWhitespaceCount(trimmedResponse) < cfg.minCharsForAnalysis!) {
    signals.push('near-empty');
    weightSum += SIGNAL_WEIGHTS['near-empty'];
  }

  // 6. token-storm — response far longer than prompt (only when prompt is non-trivial)
  if (
    promptText !== null &&
    promptText.replace(/\s/g, '').length > 50 &&
    trimmedResponse.length > promptText.length * cfg.tokenStormRatio!
  ) {
    signals.push('token-storm');
    weightSum += SIGNAL_WEIGHTS['token-storm'];
  }

  const confidence = weightSum / MAX_CONFIDENCE;
  // cjk-overrun and mostly-control-chars alone are diagnostic; repetition-loop alone is not
  // (short-token repetition like emojis or repeated headers is a normal pattern).
  const DIAGNOSTIC_SINGLE_SIGNALS: ReadonlySet<GarbageSignal> = new Set<GarbageSignal>([
    'cjk-overrun',
    'mostly-control-chars',
  ]);
  const hasDiagnosticSingle = signals.some(s => DIAGNOSTIC_SINGLE_SIGNALS.has(s));
  const isGarbage = signals.length >= 2 || hasDiagnosticSingle;

  return {
    isGarbage,
    signals,
    confidence: Math.min(confidence, 1),
    evidence: signals.length > 0 ? evidence : null,
  };
}