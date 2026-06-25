/**
 * index.ts
 * Main entry point for Ollama Orchestrator
 */

import 'dotenv/config';

// Refresh auth config from env vars BEFORE any route modules are imported.
// This ensures DEFAULT_AUTH_CONFIG reflects the runtime ENABLE_AUTH setting
// before requireAuth() is called in route modules during the import chain.
refreshAuthConfig();

import cluster from 'cluster';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { getConfigManager } from './config/config.js';
import { ERROR_MESSAGES } from './constants/index.js';
import { getPrometheusMetrics } from './controllers/metrics-controller.js';
import { requireAuth, requireAdmin, isAuthEnabled, refreshAuthConfig } from './middleware/auth.js';
import { initAuthConfigSubscription } from './middleware/auth.js';
import {
  createMonitoringRateLimiter,
  createAdminRateLimiter,
  createInferenceRateLimiter,
} from './middleware/rate-limiter.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { getOrchestratorInstance } from './orchestrator/orchestrator-instance.js';
import {
  monitoringRouter,
  adminRouter,
  inferenceRouter,
  v1Router,
  anthropicRouter,
  batchesRouter,
  authRouter,
  userRouter,
} from './routes/orchestrator.js';
import { setupRouter } from './routes/setup.routes.js';
import { getMetricsStore } from './storage/metrics-store.js';
import { getUserStore } from './storage/user-store.js';
import { isOrchestratorError } from './utils/domain-errors.js';
import { initLoggerConfigSubscription, logger } from './utils/logger.js';
import { WarmupScheduler } from './utils/warmup-scheduler.js';
import {
  getHoneypotProbeScheduler,
  resetHoneypotProbeScheduler,
} from './probe/honeypot-probe-scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ?? 5100;

// Server reference for graceful shutdown
let server: ReturnType<typeof app.listen> | undefined;

// Config manager singleton (used by dynamic CORS below)
const configManager = getConfigManager();

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

app.use(requestIdMiddleware);

// CORS middleware - dynamic lookup on each request for hot-reload support
// Empty array = same-origin only (no CORS), ['*'] = all origins, specific = whitelist
app.use(
  cors({
    origin: (origin, callback) => {
      const corsOrigins = configManager.getConfig().security.corsOrigins;
      if (corsOrigins.includes('*')) {
        callback(null, true);
        return;
      }
      if (corsOrigins.length === 0) {
        callback(null, false);
        return;
      }
      if (origin && corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-API-Key'],
    credentials: true,
    maxAge: 86400,
  })
);

// Body parsing middleware
// Capture raw body for byte-perfect forwarding to upstream servers
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      // Store raw body as Buffer on the request object for byte-perfect forwarding
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const STREAMING_ROUTES_REGEX =
  /^\/api\/(chat|generate|embeddings|tags|ps|version|show)(?:--.+)?(?:\/.*)?$|^\/api\/orchestrator\/(events|metrics\/prometheus|servers\/[^/]+\/(capability-probe|models\/pull))$|^\/v1\/(chat\/completions|completions|embeddings|models|messages)(?:--.+)?$/;

const shouldCompress = (req: express.Request): boolean => {
  const fullPath = req.originalUrl.split('?')[0] ?? req.path;
  if (STREAMING_ROUTES_REGEX.test(fullPath)) {
    return false;
  }
  return true;
};

app.use(compression({ filter: shouldCompress }));

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Initialize orchestrator
const orchestrator = getOrchestratorInstance();
logger.info('Orchestrator initialized');

initAuthConfigSubscription();
initLoggerConfigSubscription();

const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const userStore = getUserStore();

// Track whether we're in setup mode (no admin exists)
const _setupMode = false;

// Initialize function to handle async setup with proper error handling
async function initialize(): Promise<void> {
  try {
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

        await userStore.createUser(
          adminUsername.trim(),
          `${adminUsername.trim()}@local`,
          adminPassword,
          'admin'
        );
        logger.info('Default admin user created from ADMIN_USERNAME env var');
      } else {
        logger.warn('No admin users exist. Setup wizard will be served at GET /setup');
      }
    }

    // Startup guard: enforce auth must be enabled if configured
    const config = getConfigManager().getConfig();
    if (config.security.authMustBeEnabled && !isAuthEnabled()) {
      logger.error(
        'ORCHESTRATOR_AUTH_MUST_BE_ENABLED is set but authentication is disabled. Cannot start.'
      );
      process.exit(1);
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

    // Setup routes (no auth required, rate limited) - must be before auth to allow first-time setup
    app.use('/api/orchestrator', setupRouter);

    // Auth routes must be FIRST to bypass authentication checks when auth is disabled
    app.use('/api/orchestrator/auth', authRouter);

    // Monitoring routes (permissive rate limiting, require auth)
    app.use('/api/orchestrator', monitoringRateLimiter, requireAuthentication, monitoringRouter);

    // Admin routes (restrictive rate limiting, require auth + admin)
    app.use(
      '/api/orchestrator',
      adminRateLimiter,
      requireAuthentication,
      requireAdmin(),
      adminRouter
    );

    // Inference routes (rate limited, optional auth) - Ollama-compatible endpoints
    app.use('/api', inferenceRateLimiter, inferenceRouter);

    // OpenAI-compatible endpoints at /v1/*
    app.use('/v1', inferenceRateLimiter, v1Router);
    app.use('/v1', inferenceRateLimiter, anthropicRouter);
    app.use('/v1', inferenceRateLimiter, batchesRouter);

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
        healthy: stats.healthyServers,
        total: stats.totalServers,
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
    app.use(
      (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
        logger.error('Unhandled error:', { error: err });

        const status = isOrchestratorError(err) ? err.status : 500;
        const code = isOrchestratorError(err) ? err.code : 'internal_server_error';

        const requestId = (req as { requestId?: string }).requestId;
        if (req.path.startsWith('/v1')) {
          res.status(status).json({
            error: {
              message: err?.message ?? ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
              type: 'server_error',
              code,
            },
            requestId,
          });
        } else {
          res.status(status).json({
            type: `https://orchestrator.local/errors/${code}`,
            status,
            title: err?.message ?? ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
            detail: err?.message ?? 'Unknown error',
            requestId,
          });
        }
      }
    );

    // Serve static frontend files
    const frontendPath = path.join(__dirname, '../frontend/dist');
    app.use(express.static(frontendPath));

    // Setup middleware: redirect to /setup when no admin exists
    app.use((req, res, next) => {
      const noAdmin = userStore.listUsersByRole('admin').length === 0;
      if (
        req.path === '/setup' ||
        req.path.startsWith('/api/orchestrator/setup') ||
        req.path.startsWith('/api/') ||
        req.path.startsWith('/v1/') ||
        req.path === '/health' ||
        req.path.startsWith('/health/') ||
        req.path === '/metrics' ||
        req.path.startsWith('/assets/')
      ) {
        return next();
      }
      if (noAdmin) {
        return res.redirect('/setup');
      }
      next();
    });

    // Serve setup.html for /setup route
    app.get('/setup', (_req, res) => {
      res.sendFile(path.join(frontendPath, 'setup.html'));
    });

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
    const httpServer = app.listen(PORT, () => {
      server = httpServer;
      // Add Express server timeouts to prevent resource leaks
      httpServer.keepAliveTimeout = 65000;
      httpServer.headersTimeout = 66000;
      httpServer.requestTimeout = 300000; // 5 minutes - generous for AI workloads

      logger.info(`Ollama Orchestrator listening on port ${PORT}`);

      // Warn about in-memory rate limiting in multi-process deployments
      if (cluster.isPrimary || cluster.isMaster) {
        logger.warn(
          'Rate limit uses in-memory store - multi-process deployments will have weaker rate limiting. ' +
            'See docs/OPERATIONS.md for Redis setup if running in PM2/Kubernetes.'
        );
      }

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

      const warmupConfig = configManager.getConfig().autoWarmup;
      if (warmupConfig?.enabled) {
        const warmupScheduler = new WarmupScheduler({
          enabled: true,
          intervalMs: warmupConfig.intervalMs,
          topN: warmupConfig.topN,
          serversPerModel: warmupConfig.serversPerModel,
        });
        warmupScheduler.start();
        (globalThis as { __warmupScheduler?: WarmupScheduler }).__warmupScheduler = warmupScheduler;
        logger.info(
          `Warmup scheduler enabled (interval=${warmupConfig.intervalMs}ms, topN=${warmupConfig.topN})`
        );
      } else {
        logger.info('Warmup scheduler disabled by config');
      }

      const honeypotConfig = configManager.getConfig().honeypotProbes;
      if (honeypotConfig?.enabled) {
        const honeypotScheduler = getHoneypotProbeScheduler();
        honeypotScheduler.start();
        (globalThis as { __honeypotScheduler?: typeof honeypotScheduler }).__honeypotScheduler =
          honeypotScheduler;
        logger.info(
          `Honeypot probe scheduler enabled (interval=${honeypotConfig.intervalMs}ms, batchSize=${honeypotConfig.batchSize})`
        );
      } else {
        logger.info('Honeypot probe scheduler disabled by config');
      }
    });
  } catch (err) {
    logger.error('Failed to initialize orchestrator', { error: err });
    process.exit(1);
  }
}

initialize().catch(err => {
  logger.error('Unexpected error in initialize', { error: err });
  process.exit(1);
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

  const ws = (globalThis as { __warmupScheduler?: WarmupScheduler }).__warmupScheduler;
  if (ws) {
    ws.stop();
  }

  const hs = (globalThis as { __honeypotScheduler?: ReturnType<typeof getHoneypotProbeScheduler> })
    .__honeypotScheduler;
  if (hs) {
    hs.stop();
  }

  // Stop accepting new connections
  server!.close(() => {
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

  const ws = (globalThis as { __warmupScheduler?: WarmupScheduler }).__warmupScheduler;
  if (ws) {
    ws.stop();
  }

  // Stop accepting new connections
  server!.close(() => {
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
