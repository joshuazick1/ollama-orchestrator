/**
 * configController.ts
 * Configuration management API endpoints
 */

import path from 'path';

import type { Request, Response } from 'express';

import { getConfigManager, type OrchestratorConfig } from '../config/config.js';
import { logger } from '../utils/logger.js';

// Define allowed base directories for config files
const ALLOWED_CONFIG_DIRS = [
  process.cwd(),
  process.env.ORCHESTRATOR_CONFIG_DIR ?? '',
  '/etc/ollama-orchestrator',
].filter(Boolean);

/**
 * Sanitize config path to prevent path traversal attacks
 * Ensures path is within allowed directories and only allows .json files
 */
function sanitizeConfigPath(userPath: string): string | null {
  if (!userPath || typeof userPath !== 'string') {
    return null;
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(userPath);

  // Ensure file extension is .json
  if (!resolvedPath.endsWith('.json')) {
    logger.warn(`Config path rejected: must end with .json - ${userPath}`);
    return null;
  }

  // Ensure path is within allowed directories (prevent path traversal)
  const isAllowed = ALLOWED_CONFIG_DIRS.some(allowedDir => {
    const resolvedAllowed = path.resolve(allowedDir);
    return resolvedPath.startsWith(resolvedAllowed + path.sep) || resolvedPath === resolvedAllowed;
  });

  if (!isAllowed) {
    logger.warn(`Config path rejected: path traversal detected - ${userPath}`);
    return null;
  }

  // Reject paths with suspicious patterns
  const suspiciousPatterns = [
    /\.\./, // Double dots
    /[~`!$&*(){}[|<>]/, // Special characters
    /\/\/+/g, // Multiple slashes
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(userPath)) {
      logger.warn(`Config path rejected: suspicious pattern detected - ${userPath}`);
      return null;
    }
  }

  return resolvedPath;
}

/**
 * Get current configuration
 * GET /api/orchestrator/config
 */
export function getConfig(req: Request, res: Response): void {
  try {
    const manager = getConfigManager();
    const config = manager.getConfig();

    // Remove sensitive information
    const sanitizedConfig = sanitizeConfig(config);

    res.status(200).json({
      success: true,
      config: sanitizedConfig,
      source: process.env.ORCHESTRATOR_CONFIG_FILE ?? 'default',
    });
  } catch (error) {
    logger.error('Failed to get configuration:', { error });
    res.status(500).json({
      error: 'Failed to get configuration',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update configuration
 * POST /api/orchestrator/config
 */
export function updateConfig(req: Request, res: Response): void {
  try {
    const manager = getConfigManager();
    const updates = req.body as Partial<OrchestratorConfig>;

    if (!updates || typeof updates !== 'object') {
      res.status(400).json({
        error: 'Invalid request body',
        details: 'Configuration updates must be a valid object',
      });
      return;
    }

    // Validate and apply updates
    manager.updateConfig(updates);

    res.status(200).json({
      success: true,
      message: 'Configuration updated successfully',
      config: sanitizeConfig(manager.getConfig()),
    });
  } catch (error) {
    logger.error('Failed to update configuration:', { error });

    if (error instanceof Error && error.name === 'ConfigValidationError') {
      res.status(400).json({
        error: 'Configuration validation failed',
        details: error.message,
      });
    } else {
      res.status(500).json({
        error: 'Failed to update configuration',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Update a specific configuration section
 * PATCH /api/orchestrator/config/:section
 */
export function updateConfigSection(req: Request, res: Response): void {
  try {
    const manager = getConfigManager();
    const { section } = req.params;
    const updates = req.body as Record<string, unknown>;

    if (!section) {
      res.status(400).json({
        error: 'Section parameter is required',
      });
      return;
    }

    const validSections: Array<keyof OrchestratorConfig> = [
      'queue',
      'loadBalancer',
      'circuitBreaker',
      'security',
      'metrics',
      'streaming',
    ];

    const sectionKey = section as keyof OrchestratorConfig;

    if (!validSections.includes(sectionKey)) {
      res.status(400).json({
        error: 'Invalid configuration section',
        validSections,
      });
      return;
    }

    if (!updates || typeof updates !== 'object') {
      res.status(400).json({
        error: 'Invalid request body',
        details: 'Section updates must be a valid object',
      });
      return;
    }

    manager.updateSection(sectionKey, updates as Partial<OrchestratorConfig[typeof sectionKey]>);

    res.status(200).json({
      success: true,
      message: `Configuration section '${String(section)}' updated successfully`,
      section,
      config: sanitizeConfig(manager.getConfig()),
    });
  } catch (error) {
    logger.error('Failed to update configuration section:', { error });

    if (error instanceof Error && error.name === 'ConfigValidationError') {
      res.status(400).json({
        error: 'Configuration validation failed',
        details: error.message,
      });
    } else {
      res.status(500).json({
        error: 'Failed to update configuration section',
        details: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Reload configuration from file
 * POST /api/orchestrator/config/reload
 */
export async function reloadConfig(req: Request, res: Response): Promise<void> {
  try {
    const manager = getConfigManager();
    const body = req.body as { configPath?: string };
    const userPath = body.configPath ?? process.env.ORCHESTRATOR_CONFIG_FILE;

    if (!userPath) {
      res.status(400).json({
        error: 'No configuration file specified',
        details:
          'Provide configPath in request body or set ORCHESTRATOR_CONFIG_FILE environment variable',
      });
      return;
    }

    // Sanitize path to prevent directory traversal
    const configPath = sanitizeConfigPath(userPath);
    if (!configPath) {
      res.status(400).json({
        error: 'Invalid configuration file path',
        details: 'Path must be within allowed directories and end with .json',
      });
      return;
    }

    await manager.loadFromFile(configPath);

    res.status(200).json({
      success: true,
      message: 'Configuration reloaded successfully',
      config: sanitizeConfig(manager.getConfig()),
    });
  } catch (error) {
    logger.error('Failed to reload configuration:', { error });
    res.status(500).json({
      error: 'Failed to reload configuration',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Save current configuration to file
 * POST /api/orchestrator/config/save
 */
export async function saveConfig(req: Request, res: Response): Promise<void> {
  try {
    const manager = getConfigManager();
    const saveBody = req.body as { configPath?: string };
    const userPath = saveBody.configPath ?? process.env.ORCHESTRATOR_CONFIG_FILE;

    if (!userPath) {
      res.status(400).json({
        error: 'No configuration file specified',
        details:
          'Provide configPath in request body or set ORCHESTRATOR_CONFIG_FILE environment variable',
      });
      return;
    }

    // Sanitize path to prevent directory traversal
    const configPath = sanitizeConfigPath(userPath);
    if (!configPath) {
      res.status(400).json({
        error: 'Invalid configuration file path',
        details: 'Path must be within allowed directories and end with .json',
      });
      return;
    }

    await manager.saveToFile(configPath);

    res.status(200).json({
      success: true,
      message: 'Configuration saved successfully',
      path: configPath,
    });
  } catch (error) {
    logger.error('Failed to save configuration:', { error });
    res.status(500).json({
      error: 'Failed to save configuration',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Get configuration validation schema
 * GET /api/orchestrator/config/schema
 */
export function getConfigSchema(req: Request, res: Response): void {
  const schema = {
    type: 'object',
    properties: {
      port: { type: 'integer', minimum: 1, maximum: 65535, default: 5100 },
      host: { type: 'string', default: '0.0.0.0' },
      logLevel: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], default: 'info' },
      enableQueue: { type: 'boolean', default: true },
      enableCircuitBreaker: { type: 'boolean', default: true },
      enableMetrics: { type: 'boolean', default: true },
      enableStreaming: { type: 'boolean', default: true },
      enablePersistence: { type: 'boolean', default: true },
      queue: {
        type: 'object',
        properties: {
          maxSize: { type: 'integer', minimum: 1, default: 1000 },
          timeout: { type: 'integer', minimum: 1000, default: 300000 },
          priorityBoostInterval: { type: 'integer', minimum: 1000, default: 30000 },
          priorityBoostAmount: { type: 'integer', minimum: 1, default: 5 },
        },
      },
      loadBalancer: {
        type: 'object',
        properties: {
          weights: {
            type: 'object',
            properties: {
              latency: { type: 'number', minimum: 0, maximum: 1, default: 0.35 },
              successRate: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
              load: { type: 'number', minimum: 0, maximum: 1, default: 0.2 },
              capacity: { type: 'number', minimum: 0, maximum: 1, default: 0.15 },
            },
          },
          thresholds: {
            type: 'object',
            properties: {
              maxP95Latency: { type: 'integer', minimum: 100, default: 5000 },
              minSuccessRate: { type: 'number', minimum: 0, maximum: 1, default: 0.95 },
              latencyPenalty: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
              errorPenalty: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
            },
          },
        },
      },
      circuitBreaker: {
        type: 'object',
        properties: {
          baseFailureThreshold: { type: 'integer', minimum: 1, default: 5 },
          maxFailureThreshold: { type: 'integer', minimum: 1, default: 10 },
          minFailureThreshold: { type: 'integer', minimum: 1, default: 3 },
          openTimeout: { type: 'integer', minimum: 1000, default: 30000 },
          halfOpenTimeout: { type: 'integer', minimum: 1000, default: 60000 },
          halfOpenMaxRequests: { type: 'integer', minimum: 1, default: 5 },
          recoverySuccessThreshold: { type: 'integer', minimum: 1, default: 3 },
          errorRateWindow: { type: 'integer', minimum: 1000, default: 60000 },
          errorRateThreshold: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
          adaptiveThresholds: { type: 'boolean', default: true },
          errorRateSmoothing: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
        },
      },
      security: {
        type: 'object',
        properties: {
          corsOrigins: { type: 'array', items: { type: 'string' }, default: ['*'] },
          rateLimitWindowMs: { type: 'integer', minimum: 1000, default: 60000 },
          rateLimitMax: { type: 'integer', minimum: 1, default: 100 },
        },
      },
      metrics: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: true },
          prometheusEnabled: { type: 'boolean', default: true },
          prometheusPort: { type: 'integer', minimum: 1, maximum: 65535, default: 9090 },
          historyWindowMinutes: { type: 'integer', minimum: 1, default: 60 },
        },
      },
      streaming: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', default: true },
          maxConcurrentStreams: { type: 'integer', minimum: 1, default: 100 },
          timeoutMs: { type: 'integer', minimum: 1000, default: 300000 },
          bufferSize: { type: 'integer', minimum: 1, default: 1024 },
        },
      },
      persistencePath: { type: 'string', default: './data' },
      configReloadIntervalMs: { type: 'integer', minimum: 5000, default: 30000 },
    },
  };

  res.status(200).json({
    success: true,
    schema,
  });
}

/**
 * Sanitize configuration for API response (remove sensitive data)
 */
function sanitizeConfig(config: OrchestratorConfig): Partial<OrchestratorConfig> {
  // Create a copy without sensitive fields
  const sanitized = { ...config };

  // Remove API keys if present
  if (sanitized.security?.apiKeys) {
    sanitized.security = {
      ...sanitized.security,
      apiKeys: sanitized.security.apiKeys.map(() => '***REDACTED***'),
    };
  }

  return sanitized;
}
