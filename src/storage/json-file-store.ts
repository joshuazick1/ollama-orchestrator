import { promises as fs } from 'fs';

import { logger } from '../utils/logger.js';

export abstract class JsonFileStore<T> {
  protected abstract getFilePath(): string;
  protected abstract serialize(items: T[]): string;
  protected abstract deserialize(raw: string): T[];

  async save(items: T[]): Promise<void> {
    try {
      await fs.writeFile(this.getFilePath(), this.serialize(items), 'utf-8');
    } catch (err) {
      logger.error(`Failed to save ${this.constructor.name}:`, err);
      throw err;
    }
  }

  async load(): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.getFilePath(), 'utf-8');
      return this.deserialize(raw);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      logger.error(`Failed to load ${this.constructor.name}:`, err);
      return [];
    }
  }
}

export abstract class NdjsonFileStore<T> {
  protected abstract getFilePath(): string;

  async appendLine(item: T): Promise<void> {
    try {
      await fs.appendFile(this.getFilePath(), JSON.stringify(item) + '\n', 'utf-8');
    } catch (err) {
      logger.error(`Failed to append to ${this.constructor.name}:`, err);
      throw err;
    }
  }

  async loadLines(): Promise<T[]> {
    try {
      const raw = await fs.readFile(this.getFilePath(), 'utf-8');
      const items: T[] = [];
      for (const line of raw.split('\n')) {
        if (line.trim()) {
          items.push(JSON.parse(line) as T);
        }
      }
      return items;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      logger.error(`Failed to load lines from ${this.constructor.name}:`, err);
      return [];
    }
  }
}
