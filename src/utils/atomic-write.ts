import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';

import { logger } from './logger.js';

/**
 * Write a file atomically by writing to a temp file first, then renaming.
 * This prevents partial files if the write is interrupted.
 */
export async function atomicWriteFile(
  filePath: string,
  content: string,
  encoding: BufferEncoding = 'utf-8'
): Promise<void> {
  const _dir = filePath.substring(0, filePath.lastIndexOf('/'));
  const tempSuffix = randomBytes(8).toString('hex');
  const tempPath = `${filePath}.tmp.${tempSuffix}`;

  try {
    // Write to temp file first
    await fs.writeFile(tempPath, content, encoding);
    // Atomic rename
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Clean up temp file on failure
    try {
      await fs.unlink(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    logger.error(`Failed to write ${filePath} atomically`, { error: err });
    throw err;
  }
}
