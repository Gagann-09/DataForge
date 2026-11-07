import express from 'express';
import ingestRouter from './ingest.js';
import topProductsRouter from './pipelines/topProducts.js';
import funnelRouter from './pipelines/funnel.js';
import eventsRouter from './pipelines/events.js';
import statsRouter from './pipelines/stats.js';
import cors from 'cors';

import config from './config.js';
import {
  connectToDatabase,
  getDatabase,
  closeDatabase
} from './db.js';

const app = express();

app.disable('x-powered-by');

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));

app.use(express.json({
  limit: config.jsonLimit
}));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(2)}ms`
    );
  });

  next();
});

app.get('/api/health', async (req, res) => {
  try {
    await getDatabase().command({ ping: 1 });

    return res.status(200).json({
      ok: true,
      db: 'connected'
    });
  } catch {
    return res.status(503).json({
      ok: false,
      db: 'disconnected'
    });
  }
});

app.use('/api', ingestRouter);
app.use('/api', topProductsRouter);
app.use('/api', funnelRouter);
app.use('/api', eventsRouter);
app.use('/api', statsRouter);

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found'
    }
  });
});

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

  console.error('Unhandled request error:', error);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected server error occurred'
    }
  });
});

let httpServer = null;
let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down gracefully...`);

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
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exitCode = 1;
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

async function startServer() {
  try {
    await connectToDatabase();

    httpServer = app.listen(config.port, () => {
      console.log(`DataForge API listening on port ${config.port}`);
      console.log(`MongoDB connected: ${config.dbName}.${config.collectionName}`);
    });

    httpServer.on('error', (error) => {
      console.error('HTTP server error:', error);
      process.exitCode = 1;
      void shutdown('HTTP server error');
    });
  } catch (error) {
    console.error('Failed to start DataForge API:', error.message);

    try {
      await closeDatabase();
    } catch (closeError) {
      console.error('MongoDB cleanup failed:', closeError.message);
    }

    process.exitCode = 1;
  }
}

void startServer();

