/**
 * configManager.ts
 * Configuration management with persistence
 */

import path from 'path';
import { fileURLToPath } from 'url';

import type { AIServer } from '../orchestrator.types.js';
import { logger } from '../utils/logger.js';

import { JsonFileHandler, JsonFileHandlerOptions } from './jsonFileHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ConfigOptions<T> extends JsonFileHandlerOptions {
  fileName: string;
  defaults: T;
  validator?: (data: any) => data is T;
  relativePath?: string;
}

export interface ConfigManager<T> {
  get(): T;
  set(value: T): boolean;
  reload(): T | null;
  getPath(): string;
}

export function createConfigManager<T>(options: ConfigOptions<T>): ConfigManager<T> {
  const { fileName, defaults, relativePath = '../../data', validator, ...handlerOptions } = options;

  const filePath = path.resolve(__dirname, relativePath, fileName);
  const handler = new JsonFileHandler(filePath, {
    createBackups: true,
    maxBackups: 3,
    validateJson: true,
    validator,
    ...handlerOptions,
  });

  let cachedConfig: T = defaults;
  let isLoaded = false;

  const loadConfig = (): T => {
    if (isLoaded) {
      return cachedConfig;
    }

    try {
      const loaded = handler.read<T>();
      if (loaded) {
        cachedConfig = loaded;
        logger.info(`Loaded config from ${fileName}`);
      } else {
        logger.warn(`No config found at ${fileName}, using defaults`);
        handler.write(defaults);
      }
    } catch (error) {
      logger.error(`Error loading config from ${fileName}`, { error });
    }

    isLoaded = true;
    return cachedConfig;
  };

  return {
    get(): T {
      return loadConfig();
    },

    set(value: T): boolean {
      try {
        const success = handler.write(value);
        if (success) {
          cachedConfig = value;
          logger.info(`Saved config to ${fileName}`);
        } else {
          logger.error(`Failed to save config to ${fileName}`);
        }
        return success;
      } catch (error) {
        logger.error(`Error saving config to ${fileName}`, { error });
        return false;
      }
    },

    reload(): T | null {
      try {
        isLoaded = false;
        const loaded = handler.read<T>();
        if (loaded) {
          cachedConfig = loaded;
          logger.info(`Reloaded config from ${fileName}`);
          return cachedConfig;
        }
        return null;
      } catch (error) {
        logger.error(`Error reloading config from ${fileName}`, { error });
        return null;
      }
    },

    getPath(): string {
      return filePath;
    },
  };
}

// Validate server array
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validateServers = (data: any): data is AIServer[] => {
  return (
    Array.isArray(data) &&
    data.every(
      (server: Record<string, unknown>) =>
        server &&
        typeof server === 'object' &&
        typeof server.id === 'string' &&
        typeof server.url === 'string' &&
        typeof server.healthy === 'boolean' &&
        Array.isArray(server.models)
    )
  );
};

// Server configuration manager
export const serversConfig = createConfigManager<AIServer[]>({
  fileName: 'servers.json',
  relativePath: '../../data',
  defaults: [],
  validator: validateServers,
  maxBackups: 3,
});

// Bans configuration manager
export const bansConfig = createConfigManager<string[]>({
  fileName: 'bans.json',
  relativePath: '../../data',
  defaults: [],
  maxBackups: 3,
});

// Timeouts configuration manager
export const timeoutsConfig = createConfigManager<Record<string, number>>({
  fileName: 'timeouts.json',
  relativePath: '../../data',
  defaults: {},
  maxBackups: 3,
});
