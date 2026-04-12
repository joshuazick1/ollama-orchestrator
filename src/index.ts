/**
 * index.ts
 * Main entry point for Ollama Orchestrator
 */

import 'dotenv/config';

import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { getConfigManager } from './config/config.js';
import { ERROR_MESSAGES } from './constants/index.js';
import { getPrometheusMetrics } from './controllers/metrics-controller.js';
import { requireAuth, requireAdmin } from './middleware/auth.js';
import {
  createMonitoringRateLimiter,
  createAdminRateLimiter,
  createInferenceRateLimiter,
} from './middleware/rate-limiter.js';
import { getOrchestratorInstance } from './orchestrator/orchestrator-instance.js';
import {
  monitoringRouter,
  adminRouter,
  inferenceRouter,
  v1Router,
  anthropicRouter,
  authRouter,
  userRouter,
} from './routes/orchestrator.js';
import { isOrchestratorError } from './utils/domain-errors.js';
import { logger } from './utils/logger.js';
import { getUserStore } from './storage/user-store.js';
import { getMetricsStore } from './storage/metrics-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ?? 5100;

// Get CORS origins from config
const configManager = getConfigManager();
const corsOrigins = configManager.getConfig().security.corsOrigins;

// Generate a unique CSP nonce per request
app.use((_req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

// Security middleware
app.use((req, res, next) => {
  const nonce = res.locals.cspNonce as string;
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", `'nonce-${nonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'blob:', 'http:', 'https:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
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
    hsts: { maxAge: 31536000, includeSubDomains: true },
    ieNoOpen: true,
    noSniff: true,
    originAgentCluster: false,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  })(req, res, next);
});

// CORS middleware - use configured origins
// Empty array = same-origin only (no CORS), ['*'] = all origins, specific = whitelist
const corsOptions: cors.CorsOptions = {
  origin: corsOrigins.includes('*') ? true : corsOrigins.length > 0 ? corsOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
  credentials: corsOrigins.length > 0 && !corsOrigins.includes('*'),
  maxAge: 86400,
};
app.use(cors(corsOptions));

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

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const userStore = getUserStore();

if (userStore.listUsersByRole('admin').length === 0) {
  if (adminUsername && adminPassword) {
    if (adminUsername.trim().length === 0) {
      logger.error('ADMIN_USERNAME is set but empty. Cannot start.');
      process.exit(1);
    }

    if (adminPassword.length < 8) {
      logger.error('ADMIN_PASSWORD must be at least 8 characters long. Cannot start.');
      process.exit(1);
    }

    await userStore.createUser(adminUsername.trim(), `${adminUsername.trim()}@local`, adminPassword, 'admin');
    logger.info('Default admin user created from ADMIN_USERNAME env var');
  } else {
    logger.error('No admin users exist and ADMIN_USERNAME/ADMIN_PASSWORD not set. Cannot start.');
    process.exit(1);
  }
}

// Rate limiting middleware
const monitoringRateLimiter = createMonitoringRateLimiter();
const adminRateLimiter = createAdminRateLimiter();
const inferenceRateLimiter = createInferenceRateLimiter();

// Authentication middleware
const requireAuthentication = requireAuth();

// Warn if authentication is disabled
if (process.env.ENABLE_AUTH === 'false' || process.env.ORCHESTRATOR_ENABLE_AUTH === 'false') {
  logger.warn(
    'Authentication is DISABLED. All endpoints are publicly accessible. Set ENABLE_AUTH=true to secure your instance.'
  );
}

// Auth routes must be FIRST to bypass authentication checks when auth is disabled
app.use('/api/orchestrator/auth', authRouter);

// Monitoring routes (permissive rate limiting, require auth)
app.use('/api/orchestrator', monitoringRateLimiter, requireAuthentication, monitoringRouter);

// Admin routes (restrictive rate limiting, require auth + admin)
app.use('/api/orchestrator', adminRateLimiter, requireAuthentication, requireAdmin(), adminRouter);

// Inference routes (rate limited, optional auth) - Ollama-compatible endpoints
app.use('/api', inferenceRateLimiter, inferenceRouter);

// OpenAI-compatible endpoints at /v1/*
app.use('/v1', inferenceRateLimiter, v1Router);
app.use('/v1', inferenceRateLimiter, anthropicRouter);

// User management routes (require auth + admin for most operations)
app.use('/api/orchestrator', adminRateLimiter, requireAuthentication, userRouter);

// Prometheus metrics endpoint at root
// Only allow access from localhost/internal IPs in production
const INTERNAL_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];
app.get('/metrics', (req, res) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const isInternal = INTERNAL_IP_PATTERNS.some(pattern => pattern.test(ip));
  if (process.env.NODE_ENV === 'production' && !isInternal) {
    res.status(403).json({ error: 'Metrics only available internally' });
    return;
  }
  getPrometheusMetrics(req, res);
});

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

// REC-8: Liveness probe – always 200 as long as the process is alive
app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

// REC-8: Readiness probe – 503 if no healthy servers are available
app.get('/health/ready', (_req, res) => {
  const servers = orchestrator.getServers();
  const hasHealthy = servers.some(s => s.healthy);
  if (hasHealthy) {
    res.json({ status: 'ready', healthyServers: servers.filter(s => s.healthy).length });
  } else {
    res.status(503).json({
      status: 'not_ready',
      reason: 'No healthy servers available',
      totalServers: servers.length,
    });
  }
});

// Error handler
// REC-40: return OpenAI-compatible error format for /v1 routes
// Audit E-5: RFC 7807 error format for internal routes
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error:', { error: err });

  const status = isOrchestratorError(err) ? err.status : 500;
  const code = isOrchestratorError(err) ? err.code : 'internal_server_error';

  if (req.path.startsWith('/v1')) {
    res.status(status).json({
      error: {
        message: err?.message ?? ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
        type: 'server_error',
        code,
      },
    });
  } else {
    res.status(status).json({
      type: `https://orchestrator.local/errors/${code}`,
      status,
      title: err?.message ?? ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
      detail: err?.message ?? 'Unknown error',
    });
  }
});

// Serve static frontend files
const frontendPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(frontendPath));

// SPA Fallback for non-API routes
app.get('*', (req, res, next) => {
  if (
    req.path.startsWith('/api') ||
    req.path.startsWith('/v1') || // REC-41: exclude /v1 from SPA fallback
    req.path === '/metrics' ||
    req.path === '/health' ||
    req.path.startsWith('/health/')
  ) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// 404 handler (Audit E-5: RFC 7807)
app.use((_req, res) => {
  res.status(404).json({
    type: 'https://orchestrator.local/errors/not_found',
    status: 404,
    title: ERROR_MESSAGES.NOT_FOUND,
  });
});

// Start server
const server = app.listen(PORT, () => {
  // Add Express server timeouts to prevent resource leaks
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 300000; // 5 minutes - generous for AI workloads

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
  logger.info(`  - Anthropic compatible: POST /v1/messages`);
  logger.info(`  - Health check:      GET    /health`);
  logger.info(`  - Logging:           GET    /api/orchestrator/logs`);
  logger.info(`  - Logging:           POST   /api/orchestrator/logs/clear`);
});

// Global error handlers to prevent silent crashes
process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception — shutting down', { error: error.message, stack: error.stack });
  // Give logger time to flush, then exit
  setTimeout(() => process.exit(1), 1000).unref();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');

  // Flush metrics synchronously
  const metricsStore = getMetricsStore();
  metricsStore.flushSync();

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Shutdown orchestrator (wait for in-flight requests)
    void orchestrator
      .shutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('Orchestrator shutdown failed', { error: String(err) });
        process.exit(1);
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

  // Flush metrics synchronously
  const metricsStore = getMetricsStore();
  metricsStore.flushSync();

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');

    // Shutdown orchestrator (wait for in-flight requests)
    void orchestrator
      .shutdown()
      .then(() => {
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error('Orchestrator shutdown failed', { error: String(err) });
        process.exit(1);
      });

    // Force exit after timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000).unref();
  });
});

export default app;
