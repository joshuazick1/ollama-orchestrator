/**
 * index.ts
 * Main entry point for Ollama Orchestrator
 */

import 'dotenv/config';

import path from 'path';
import { fileURLToPath } from 'url';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { ERROR_MESSAGES } from './constants/index.js';
import { getPrometheusMetrics } from './controllers/metricsController.js';
import { requireAuth } from './middleware/auth.js';
import { createMonitoringRateLimiter, createAdminRateLimiter } from './middleware/rateLimiter.js';
import { getOrchestratorInstance } from './orchestrator-instance.js';
import { monitoringRouter, adminRouter, inferenceRouter, v1Router } from './routes/orchestrator.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ?? 5100;

// Security middleware - relaxed for HTTP access
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: false,
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: false,
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: false,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  })
);

// CORS middleware
app.use(cors());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Initialize orchestrator
const orchestrator = getOrchestratorInstance();
logger.info('Orchestrator initialized');

// Rate limiting middleware
const monitoringRateLimiter = createMonitoringRateLimiter();
const adminRateLimiter = createAdminRateLimiter();

// Authentication middleware
const requireAuthentication = requireAuth();

// Routes with rate limiting and authentication
// Monitoring routes (permissive rate limiting, require auth)
app.use('/api/orchestrator', monitoringRateLimiter, requireAuthentication, monitoringRouter);

// Admin routes (restrictive rate limiting, require auth)
app.use('/api/orchestrator', adminRateLimiter, requireAuthentication, adminRouter);

// Inference routes (no rate limiting, optional auth) - Ollama-compatible endpoints
app.use('/api', inferenceRouter);

// OpenAI-compatible endpoints at /v1/*
app.use('/v1', v1Router);

// Prometheus metrics endpoint at root
app.get('/metrics', getPrometheusMetrics);

// Health check endpoint
app.get('/health', (_req, res) => {
  const stats = orchestrator.getStats();
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    orchestrator: stats,
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', { error: err });
  res.status(500).json({
    error: ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
    details: err?.message ?? 'Unknown error',
  });
});

// Serve static frontend files
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// SPA Fallback for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/metrics' || req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const server = app.listen(PORT, () => {
  logger.info(`Ollama Orchestrator listening on port ${PORT}`);
  logger.info(`API endpoints:`);
  logger.info(`  - Server management: POST   /api/orchestrator/servers/add`);
  logger.info(`  - Server management: DELETE /api/orchestrator/servers/:id`);
  logger.info(`  - Server management: PATCH  /api/orchestrator/servers/:id`);
  logger.info(`  - Server management: GET    /api/orchestrator/servers`);
  logger.info(`  - Server management: GET    /api/orchestrator/model-map`);
  logger.info(`  - Ollama compatible: GET    /api/tags`);
  logger.info(`  - Ollama compatible: POST   /api/generate`);
  logger.info(`  - Ollama compatible: POST   /api/chat`);
  logger.info(`  - Ollama compatible: POST   /api/embeddings`);
  logger.info(`  - OpenAI compatible: POST   /v1/chat/completions`);
  logger.info(`  - OpenAI compatible: POST   /v1/completions`);
  logger.info(`  - OpenAI compatible: POST   /v1/embeddings`);
  logger.info(`  - Health check:      GET    /health`);
  logger.info(`  - Logging:           GET    /api/orchestrator/logs`);
  logger.info(`  - Logging:           POST   /api/orchestrator/logs/clear`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Shutdown orchestrator (wait for in-flight requests)
    void orchestrator.shutdown().then(() => {
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000).unref();
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Shutdown orchestrator (wait for in-flight requests)
    void orchestrator.shutdown().then(() => {
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000).unref();
  });
});

export default app;
