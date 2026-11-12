import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import ingestRouter from './ingest.js';
import topProductsRouter from './pipelines/topProducts.js';
import funnelRouter from './pipelines/funnel.js';
import eventsRouter from './pipelines/events.js';
import statsRouter from './pipelines/stats.js';
import segmentsRouter from './pipelines/segments.js';

import securityHeaders from './middleware/security.js';
import createRateLimiter from './middleware/rateLimiter.js';

import config from './config.js';
import {
  connectToDatabase,
  getDatabase,
  closeDatabase
} from './db.js';

const app = express();

// Disable Express fingerprinting
app.disable('x-powered-by');

// Proxy trust: configure Express with validated trustProxy setting (false by default)
app.set('trust proxy', config.trustProxy);

// HTTP Security Headers
app.use(securityHeaders);

// Configurable CORS with preserved localhost development defaults
app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// In-memory rate limiting for API protection (instance-local safeguard)
const rateLimiter = createRateLimiter({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax
});
app.use('/api', rateLimiter);

// Parse JSON request body with strict payload ceiling
app.use(express.json({
  limit: config.jsonLimit
}));

/**
 * Sanitize an unmatched URL path by stripping query strings and redacting sensitive path segments
 * (e.g. tokens, API keys, secrets, hashes, or passwords appearing in URL path segments).
 *
 * @param {string} rawPath - Raw path string
 * @returns {string} Sanitized path safe for logging
 */
function sanitizePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') {
    return '/';
  }

  // 1. Strip query string
  const cleanPath = rawPath.split('?')[0] || '/';

  // 2. Redact sensitive path segments:
  // - Segments following sensitive labels (token, key, secret, password, auth, credentials)
  // - High-entropy or patterned credentials (JWTs, API key prefixes, long hex/base64 strings)
  return cleanPath
    .replace(/(?<=\/(?:tokens?|keys?|secrets?|passwords?|auth|credentials?)\/)[^/]+/gi, '***')
    .replace(/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g, '***')
    .replace(/\b(?:sk|pk|tok|sec|api|key)_[a-zA-Z0-9_-]{8,}\b/gi, '***')
    .replace(/\b[a-f0-9]{32,}\b/gi, '***');
}

/**
 * Resolves a safe request route string for logging.
 * Prefers Express's matched route pattern (e.g. /api/events, /api/users/:id)
 * so sensitive path parameters, query parameters, bodies, and auth tokens
 * are never logged.
 *
 * @param {import('express').Request} req - Express request object
 * @returns {string} Safe route pattern or sanitized route path
 */
function getRequestRoute(req) {
  if (req?.route?.path) {
    const routePath = typeof req.route.path === 'string'
      ? req.route.path
      : String(req.route.path);
    return `${req.baseUrl || ''}${routePath}` || '/';
  }

  const rawPath = (req?.originalUrl ? req.originalUrl.split('?')[0] : req?.path) || '/';
  return sanitizePath(rawPath);
}

// Structured request logging (sanitized: query parameters, auth headers, cookies, and bodies are never logged)
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const requestRoute = getRequestRoute(req);

    console.log(
      `${req.method} ${requestRoute} ${res.statusCode} ${durationMs.toFixed(2)}ms`
    );
  });

  next();
});

// Non-sensitive health and readiness probe
app.get('/api/health', async (req, res) => {
  try {
    await getDatabase().command({ ping: 1 });

    return res.status(200).json({
      status: 'healthy',
      ok: true,
      db: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch {
    return res.status(503).json({
      status: 'unhealthy',
      ok: false,
      db: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
});

// Mount application API routers
app.use('/api', ingestRouter);
app.use('/api', topProductsRouter);
app.use('/api', funnelRouter);
app.use('/api', eventsRouter);
app.use('/api', statsRouter);
app.use('/api', segmentsRouter);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
});

// Centralized error handling middleware
app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error.type === 'entity.too.large') {
    return res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the 5 MB limit'
      }
    });
  }

  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid JSON request body'
      }
    });
  }

  const cleanError = sanitizeError(error);
  console.error('Unhandled request error:', cleanError?.stack || cleanError?.message || cleanError);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred'
    }
  });
});

/**
 * Sanitize an error or message so credentials cannot appear in terminal or CI output.
 * Redacts credentials from error messages, stack traces, and strings while preserving diagnostic context.
 *
 * @param {Error|string|unknown} error - Error object or string
 * @returns {Error|string} Sanitized error object or string
 */
function sanitizeError(error) {
  if (!error) return error;

  const redact = (str) => {
    if (typeof str !== 'string') return str;
    return str
      // 1. Redact MongoDB URIs (standard & SRV, including encoded chars and edge cases)
      .replace(/(mongodb(?:\+srv)?:\/\/)(?:[^\/\s?]*@)/gi, '$1***:***@')
      // 2. Redact Authorization headers and credentials (Bearer / Basic / Token)
      .replace(/(Authorization\s*:\s*(?:Bearer|Basic|Token)\s+)[^\s,;]+/gi, '$1***')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 ***')
      // 3. Redact common secret-bearing key-value assignments (quoted or unquoted values)
      .replace(
        /(\b(?:password|passwd|pwd|access_token|refresh_token|auth_token|api_key|apikey|client_secret|api_secret|secret_key|secret|token)\s*[:=]\s*)(?:(['"])([^\r\n]*?)\2|([^\s&,;'"<>#]+))/gi,
        (match, prefix, quote) => (quote ? `${prefix}${quote}***${quote}` : `${prefix}***`)
      )
      // 4. Redact sensitive query parameters in arbitrary HTTP/HTTPS URLs
      .replace(
        /([?&](?:token|access_token|refresh_token|auth_token|api_key|apikey|secret|client_secret|password|pwd)=)([^&\s"'`<>#]+)/gi,
        '$1***'
      );
  };

  if (typeof error === 'string') {
    return redact(error);
  }

  if (error instanceof Error) {
    const cleanError = new Error(redact(error.message));
    cleanError.name = error.name;
    if (error.code !== undefined) cleanError.code = error.code;
    if (error.stack) {
      cleanError.stack = redact(error.stack);
    }
    return cleanError;
  }

  if (typeof error === 'object') {
    try {
      return JSON.parse(redact(JSON.stringify(error)));
    } catch {
      return redact(String(error));
    }
  }

  return redact(String(error));
}

let httpServer = null;
let shuttingDown = false;
let targetExitCode = 0;

// Direct execution check (prevents auto-start when imported by test suites)
const isDirectRun =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

async function shutdown(signal, exitCode = 0) {
  // If a fatal event occurs, promote exitCode to nonzero (default 1)
  if (exitCode !== 0) {
    targetExitCode = exitCode;
    process.exitCode = exitCode;
  }

  // Idempotence guard: if shutdown is already underway, do not re-run cleanup,
  // but ensure any subsequent fatal exitCode promotion took effect above.
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);

  // Force termination fallback if cleanup stalls
  const forceExitTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out after 10s. Forcing exit.');
    const code = targetExitCode !== 0 ? targetExitCode : (process.exitCode || 1);
    process.exit(code);
  }, 10000);

  if (forceExitTimeout.unref) {
    forceExitTimeout.unref();
  }

  try {
    if (httpServer?.listening) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    }

    await closeDatabase();
    console.log('HTTP server and MongoDB connection closed.');
    clearTimeout(forceExitTimeout);

    const finalExitCode = targetExitCode !== 0 ? targetExitCode : (process.exitCode || 0);
    if (isDirectRun || finalExitCode !== 0) {
      process.exit(finalExitCode);
    }
  } catch (error) {
    const cleanError = sanitizeError(error);
    console.error('Error during shutdown:', cleanError?.stack || cleanError?.message || cleanError);
    targetExitCode = 1;
    process.exitCode = 1;
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT', 0);
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM', 0);
});

process.on('unhandledRejection', (reason) => {
  const cleanReason = sanitizeError(reason);
  console.error('Unhandled Promise Rejection:', cleanReason?.stack || cleanReason?.message || cleanReason);
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  const cleanError = sanitizeError(error);
  console.error('Uncaught Exception thrown:', cleanError?.stack || cleanError?.message || cleanError);
  void shutdown('uncaughtException', 1);
});

async function startServer() {
  try {
    await connectToDatabase();

    httpServer = app.listen(config.port, () => {
      console.log(`DataForge API listening on port ${config.port}`);
      console.log(`MongoDB connected: ${config.dbName}.${config.collectionName}`);
      console.log(`Active CORS origins: ${config.corsOrigins.join(', ')}`);
      console.log(`Rate limiting active: ${config.rateLimitMax} req / ${config.rateLimitWindowMs}ms`);
    });

    httpServer.on('error', (error) => {
      const cleanError = sanitizeError(error);
      console.error('HTTP server error:', cleanError?.stack || cleanError?.message || cleanError);
      void shutdown('HTTP server error', 1);
    });
  } catch (error) {
    const cleanError = sanitizeError(error);
    console.error('Failed to start DataForge API:', cleanError?.message || cleanError);

    try {
      await closeDatabase();
    } catch (closeError) {
      const cleanClose = sanitizeError(closeError);
      console.error('MongoDB cleanup failed:', cleanClose?.message || cleanClose);
    }

    process.exitCode = 1;
  }
}

if (isDirectRun) {
  void startServer();
}

export { app, startServer, shutdown, rateLimiter, sanitizeError, getRequestRoute, sanitizePath };
export default app;
