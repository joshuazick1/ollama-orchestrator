/**
 * jsonFileHandler.ts
 * Robust JSON file I/O with backup support
 */

import fs from 'fs';
import path from 'path';

import { logger } from '../utils/logger.js';
import { safeJsonParse, safeJsonStringify } from '../utils/json-utils.js';

export interface JsonFileHandlerOptions {
  createBackups?: boolean;
  maxBackups?: number;
  validateJson?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  validator?: (data: any) => boolean;
}

export class JsonFileHandler {
  private filePath: string;
  private options: Required<JsonFileHandlerOptions>;

  constructor(filePath: string, options: JsonFileHandlerOptions = {}) {
    this.filePath = filePath;
    this.options = {
      createBackups: options.createBackups ?? true,
      maxBackups: options.maxBackups ?? 5,
      validateJson: options.validateJson ?? true,
      validator: options.validator ?? ((): boolean => true),
    };

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  read<T>(): T | null {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }

      const content = fs.readFileSync(this.filePath, 'utf-8');

      if (this.options.validateJson) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsed = safeJsonParse(content) as T;
        if (this.options.validator && !this.options.validator(parsed)) {
          logger.error(`[JsonFileHandler] Validation failed for ${this.filePath}`);
          return null;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return parsed;
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return safeJsonParse(content) as T;
    } catch (error) {
      logger.error(`[JsonFileHandler] Error reading ${this.filePath}`, { error });
      return null;
    }
  }

  write<T>(data: T): boolean {
    try {
      // Create backup if file exists
      if (this.options.createBackups && fs.existsSync(this.filePath)) {
        this.createBackup();
      }

      // Write to temp file first
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, safeJsonStringify(data, null, 2) as string, 'utf-8');

      // Atomic rename
      fs.renameSync(tempPath, this.filePath);

      return true;
    } catch (error) {
      logger.error(`[JsonFileHandler] Error writing ${this.filePath}`, { error });

      // Cleanup temp file if exists
      try {
        const tempPath = `${this.filePath}.tmp`;
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }

      return false;
    }
  }

  private createBackup(): void {
    try {
      const timestamp = Date.now();
      const backupPath = `${this.filePath}.backup.${timestamp}`;

      fs.copyFileSync(this.filePath, backupPath);

      // Clean up old backups
      this.cleanupOldBackups();
    } catch (error) {
      logger.warn(`[JsonFileHandler] Failed to create backup`, { error });
    }
  }

  private cleanupOldBackups(): void {
    try {
      const dir = path.dirname(this.filePath);
      const basename = path.basename(this.filePath);

      const backups = fs
        .readdirSync(dir)
        .filter(f => f.startsWith(`${basename}.backup.`))
        .map(f => ({
          name: f,
          path: path.join(dir, f),
          time: fs.statSync(path.join(dir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      // Remove excess backups
      if (backups.length > this.options.maxBackups) {
        for (const backup of backups.slice(this.options.maxBackups)) {
          try {
            fs.unlinkSync(backup.path);
          } catch {
            // Ignore deletion errors
          }
        }
      }
    } catch (error) {
      logger.warn(`[JsonFileHandler] Failed to cleanup backups`, { error });
    }
  }
}
