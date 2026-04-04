import fs from 'fs';
import path from 'path';

import Database from 'better-sqlite3';

import { logger } from '../utils/logger.js';

import { applySchema } from './schema.js';
import { DEFAULT_STORAGE_CONFIG } from './types.js';

export class OperationalStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? DEFAULT_STORAGE_CONFIG.dbPath;

    // Ensure data directory exists
    const dir = path.dirname(path.resolve(resolvedPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');

    applySchema(this.db);

    logger.info(`[OperationalStore] Opened SQLite database at ${resolvedPath}`);
  }

  close(): void {
    this.db.close();
    logger.info('[OperationalStore] Database closed');
  }
}

let _instance: OperationalStore | undefined;

export function getOperationalStore(dbPath?: string): OperationalStore {
  if (!_instance) {
    _instance = new OperationalStore(dbPath);
  }
  return _instance;
}

export function setOperationalStore(store: OperationalStore): void {
  _instance = store;
}

export function resetOperationalStore(): void {
  if (_instance) {
    try {
      _instance.close();
    } catch {
      // ignore errors during reset
    }
    _instance = undefined;
  }
}
