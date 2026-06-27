import crypto from 'crypto';

export const PREFIX_HASH_DEFAULT_TOKEN_COUNT = 512;
const HASH_PREFIX_LENGTH = 16;

export function hashPrefix(
  content: string,
  tokenCount: number = PREFIX_HASH_DEFAULT_TOKEN_COUNT
): string {
  const words = content.trim().split(/\s+/);
  const truncated = words.slice(0, tokenCount).join(' ');
  const hash = crypto.createHash('sha256').update(truncated, 'utf-8').digest('hex');
  return hash.slice(0, HASH_PREFIX_LENGTH);
}
