import dotenv from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const serverDirectory = resolve(currentDirectory, '..');

dotenv.config({
  path: resolve(serverDirectory, '.env')
});

const nodeEnv = process.env.NODE_ENV || 'development';
const rawPort = process.env.PORT ?? '4000';
const port = Number(rawPort);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT configuration: ${rawPort}`);
}

const mongodbUri =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';

const dbName = process.env.DB_NAME || 'dataforge';
const collectionName = process.env.COLLECTION_NAME || 'events';

if (!mongodbUri.trim()) {
  throw new Error('MONGODB_URI must not be empty');
}

if (!dbName.trim()) {
  throw new Error('DB_NAME must not be empty');
}

if (!collectionName.trim()) {
  throw new Error('COLLECTION_NAME must not be empty');
}

// Configurable CORS origins with preserved localhost development defaults
const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;

if (corsOrigins.length === 0) {
  throw new Error('CORS_ORIGIN, if specified, must contain at least one non-empty origin');
}

const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isValidSubnetOrIp(token) {
  if (TRUST_PROXY_KEYWORDS.has(token.toLowerCase())) {
    return true;
  }

  if (isIP(token)) {
    return true;
  }

  const slashIndex = token.indexOf('/');
  if (slashIndex !== -1) {
    const ip = token.slice(0, slashIndex);
    const prefixStr = token.slice(slashIndex + 1);
    if (!/^\d+$/.test(prefixStr)) {
      return false;
    }
    const prefix = Number(prefixStr);
    const ipVersion = isIP(ip);
    if (ipVersion === 4 && prefix >= 0 && prefix <= 32) {
      return true;
    }
    if (ipVersion === 6 && prefix >= 0 && prefix <= 128) {
      return true;
    }
  }

  return false;
}

export function parseTrustProxy(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return false;
  }
  if (typeof rawValue === 'boolean') {
    return rawValue;
  }
  if (typeof rawValue === 'number') {
    if (Number.isInteger(rawValue) && rawValue >= 0) {
      return rawValue;
    }
    throw new Error(`Invalid TRUST_PROXY configuration: hop count must be a non-negative integer (received ${rawValue})`);
  }
  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid TRUST_PROXY configuration: unexpected type ${typeof rawValue}`);
  }

  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return false;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'false') {
    return false;
  }
  if (lower === 'true') {
    return true;
  }

  if (/^-?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (num >= 0) {
      return num;
    }
    throw new Error(`Invalid TRUST_PROXY configuration: hop count must be a non-negative integer (received "${trimmed}")`);
  }

  const tokens = trimmed.split(',').map(s => s.trim()).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('Invalid TRUST_PROXY configuration: empty subnet list');
  }

  for (const token of tokens) {
    if (!isValidSubnetOrIp(token)) {
      throw new Error(`Invalid TRUST_PROXY configuration: "${token}" is not a valid IP address, CIDR subnet, or supported keyword`);
    }
  }

  return tokens.length === 1 ? tokens[0] : tokens;
}

// Proxy trust setting: parse and validate explicit configuration
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

// In-memory rate limiting configuration
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 300);

if (!Number.isFinite(rateLimitWindowMs) || rateLimitWindowMs <= 0) {
  throw new Error(`Invalid RATE_LIMIT_WINDOW_MS: ${process.env.RATE_LIMIT_WINDOW_MS}`);
}

if (!Number.isInteger(rateLimitMax) || rateLimitMax <= 0) {
  throw new Error(`Invalid RATE_LIMIT_MAX: ${process.env.RATE_LIMIT_MAX}`);
}

// Startup validation for production deployment readiness
if (nodeEnv === 'production') {
  if (mongodbUri.includes('127.0.0.1') || mongodbUri.includes('localhost')) {
    console.warn(
      '[CONFIG WARNING] NODE_ENV is set to "production" but MONGODB_URI points to a local address without replica set / TLS configuration.'
    );
  }
}

export const config = Object.freeze({
  nodeEnv,
  port,
  mongodbUri,
  dbName,
  collectionName,
  corsOrigins,
  trustProxy,
  rateLimitWindowMs,
  rateLimitMax,
  jsonLimit: '5mb',
  maxPoolSize: 20,
  serverSelectionTimeoutMS: 5000
});

export default config;
