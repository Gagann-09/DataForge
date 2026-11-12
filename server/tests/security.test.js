import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { securityHeaders } from '../src/middleware/security.js';
import { createRateLimiter } from '../src/middleware/rateLimiter.js';
import { config, parseTrustProxy } from '../src/config.js';
import { sanitizeUri, sanitizeError } from '../scripts/seed.js';
import { getRequestRoute, sanitizePath } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

test('Security Middleware: applies mandatory HTTP security headers', () => {
  const req = {
    secure: false,
    headers: {}
  };

  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    }
  };

  let nextCalled = false;
  securityHeaders(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-xss-protection'], '0');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'");
});

test('Security Middleware: applies Strict-Transport-Security only when Express validates connection is secure', () => {
  const secureReq = {
    secure: true,
    headers: {}
  };

  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    }
  };

  securityHeaders(secureReq, res, () => {});
  assert.equal(headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
});

test('Security Middleware: ignores untrusted raw x-forwarded-proto headers when req.secure is false', () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';

  try {
    const untrustedReq = {
      secure: false,
      headers: { 'x-forwarded-proto': 'https' }
    };

    const headers = {};
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      }
    };

    securityHeaders(untrustedReq, res, () => {});
    assert.equal(
      headers['strict-transport-security'],
      undefined,
      'Must not trust raw x-forwarded-proto when Express has not validated proxy trust'
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('Trust Proxy: parses all supported valid configurations', () => {
  // 1. Unset, empty, or false variants -> boolean false
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(null), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('   '), false);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('FALSE'), false);
  assert.equal(parseTrustProxy(false), false);

  // 2. True variants -> boolean true
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('TRUE'), true);
  assert.equal(parseTrustProxy(true), true);

  // 3. Numeric hop counts -> non-negative integer
  assert.equal(parseTrustProxy('0'), 0);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('5'), 5);
  assert.equal(parseTrustProxy(1), 1);
  assert.equal(parseTrustProxy(0), 0);

  // 4. Subnet, IP, and keyword values
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('linklocal'), 'linklocal');
  assert.equal(parseTrustProxy('uniquelocal'), 'uniquelocal');
  assert.equal(parseTrustProxy('127.0.0.1'), '127.0.0.1');
  assert.equal(parseTrustProxy('10.0.0.0/8'), '10.0.0.0/8');
  assert.equal(parseTrustProxy('::1'), '::1');
  assert.equal(parseTrustProxy('fe80::/10'), 'fe80::/10');

  // 5. Comma-separated subnet values -> array of strings
  assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8'), ['loopback', '10.0.0.0/8']);
  assert.deepEqual(parseTrustProxy('127.0.0.1, 192.168.0.0/16'), ['127.0.0.1', '192.168.0.0/16']);
});

test('Trust Proxy: rejects invalid configurations with clear descriptive errors', () => {
  const invalidCases = [
    { input: '-1', pattern: /hop count must be a non-negative integer/ },
    { input: '-5', pattern: /hop count must be a non-negative integer/ },
    { input: -1, pattern: /hop count must be a non-negative integer/ },
    { input: 'invalid_string', pattern: /not a valid IP address, CIDR subnet, or supported keyword/ },
    { input: '192.168.1.500', pattern: /not a valid IP address, CIDR subnet, or supported keyword/ },
    { input: '10.0.0.0/33', pattern: /not a valid IP address, CIDR subnet, or supported keyword/ },
    { input: '127.0.0.1, bad_subnet', pattern: /not a valid IP address, CIDR subnet, or supported keyword/ },
    { input: {}, pattern: /unexpected type/ },
    { input: 1.5, pattern: /hop count must be a non-negative integer/ }
  ];

  for (const { input, pattern } of invalidCases) {
    assert.throws(
      () => parseTrustProxy(input),
      pattern,
      `Expected input ${JSON.stringify(input)} to throw error matching ${pattern}`
    );
  }
});

test('Rate Limiter: permits requests within quota and reports rate limit headers', () => {
  const limiter = createRateLimiter({
    windowMs: 10000,
    max: 3
  });

  const req = {
    ip: '192.168.1.100',
    path: '/api/stats'
  };

  const headers = {};
  let status = 200;
  let body = null;

  const res = {
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    }
  };

  let nextCount = 0;
  const next = () => { nextCount++; };

  // Call 1: permitted
  limiter(req, res, next);
  assert.equal(nextCount, 1);
  assert.equal(headers['x-ratelimit-limit'], 3);
  assert.equal(headers['x-ratelimit-remaining'], 2);

  // Call 2: permitted
  limiter(req, res, next);
  assert.equal(nextCount, 2);
  assert.equal(headers['x-ratelimit-remaining'], 1);

  // Call 3: permitted
  limiter(req, res, next);
  assert.equal(nextCount, 3);
  assert.equal(headers['x-ratelimit-remaining'], 0);

  // Call 4: exceeded
  limiter(req, res, next);
  assert.equal(nextCount, 3, 'Next should not be called when rate limit is exceeded');
  assert.equal(status, 429);
  assert.equal(body?.error?.code, 'RATE_LIMIT_EXCEEDED');
  assert.ok(headers['retry-after'] >= 1);

  limiter.stop();
});

test('Rate Limiter: skips /api/health probes', () => {
  const limiter = createRateLimiter({
    windowMs: 10000,
    max: 1
  });

  const req = {
    ip: '192.168.1.100',
    path: '/api/health'
  };

  const res = {
    setHeader() {},
    status() { return this; },
    json() { return this; }
  };

  let nextCount = 0;
  const next = () => { nextCount++; };

  limiter(req, res, next);
  limiter(req, res, next);
  limiter(req, res, next);

  assert.equal(nextCount, 3, 'Health endpoint should bypass rate limiter');
  limiter.stop();
});

test('Configuration: verifies security and network defaults', () => {
  assert.ok(Array.isArray(config.corsOrigins));
  assert.ok(config.corsOrigins.includes('http://localhost:5173'));
  assert.ok(config.corsOrigins.includes('http://127.0.0.1:5173'));
  assert.equal(config.trustProxy, false, 'trustProxy should be boolean false by default to prevent IP spoofing');
  assert.ok(config.rateLimitMax >= 100, 'Rate limit max should be sufficient for dashboard polling');
  assert.ok(config.rateLimitWindowMs > 0);
});

test('Seed Credential Protection: sanitizeUri redacts credentials while preserving host and database', () => {
  // Plain URI without auth
  assert.equal(sanitizeUri('mongodb://127.0.0.1:27017/dataforge'), 'mongodb://127.0.0.1:27017/dataforge');

  // Standard auth
  assert.equal(
    sanitizeUri('mongodb://app_user:p%40ssw0rd!@10.0.1.5:27017/dataforge?authSource=admin'),
    'mongodb://***:***@10.0.1.5:27017/dataforge?authSource=admin'
  );

  // SRV replica set auth
  assert.equal(
    sanitizeUri('mongodb+srv://admin_user:SuperSecret123@cluster0.abcde.mongodb.net/production?retryWrites=true'),
    'mongodb+srv://***:***@cluster0.abcde.mongodb.net/production?retryWrites=true'
  );

  // Encoded credentials with special characters (%40, %23, %24, %25, etc.)
  assert.equal(
    sanitizeUri('mongodb://user%40corp.com:P%23ss%24w%25rd!@db.internal:27017/prod'),
    'mongodb://***:***@db.internal:27017/prod'
  );

  // SRV with encoded symbols
  assert.equal(
    sanitizeUri('mongodb+srv://svc_account:pass%2Bword%2F123@cluster.example.net/analytics?authSource=admin'),
    'mongodb+srv://***:***@cluster.example.net/analytics?authSource=admin'
  );

  // User without password
  assert.equal(
    sanitizeUri('mongodb://readonly_user@10.0.0.1:27017/test'),
    'mongodb://***:***@10.0.0.1:27017/test'
  );

  // Malformed URIs with leading colons or empty username
  assert.equal(
    sanitizeUri('mongodb://:justpassword@host.local:27017/db'),
    'mongodb://***:***@host.local:27017/db'
  );
  assert.equal(
    sanitizeUri('mongodb://@host.local:27017/db'),
    'mongodb://***:***@host.local:27017/db'
  );

  // Empty, null, undefined, or non-string inputs
  assert.equal(sanitizeUri(''), '');
  assert.equal(sanitizeUri(null), '');
  assert.equal(sanitizeUri(undefined), '');
  assert.equal(sanitizeUri(12345), '');
});

test('Seed Credential Protection: sanitizeError redacts credentials from error messages and stacks', () => {
  const rawMsg = 'Connection failed: mongodb://sensitive_user:secret_pass@127.0.0.1:27017/dataforge';
  const rawError = new Error(rawMsg);
  rawError.stack = `Error: ${rawMsg}\n    at connect (file:///server.js:10:5)`;

  const sanitized = sanitizeError(rawError);
  assert.ok(!sanitized.message.includes('secret_pass'), 'Message must not contain password');
  assert.ok(!sanitized.message.includes('sensitive_user'), 'Message must not contain username');
  assert.ok(sanitized.message.includes('mongodb://***:***@127.0.0.1:27017/dataforge'));

  if (sanitized.stack) {
    assert.ok(!sanitized.stack.includes('secret_pass'), 'Stack must not contain password');
    assert.ok(!sanitized.stack.includes('sensitive_user'), 'Stack must not contain username');
    assert.ok(sanitized.stack.includes('mongodb://***:***@127.0.0.1:27017/dataforge'));
  }

  // String error
  const stringSanitized = sanitizeError(rawMsg);
  assert.equal(stringSanitized, 'Connection failed: mongodb://***:***@127.0.0.1:27017/dataforge');

  // SRV error message
  const srvError = new Error('SRV lookup failed for mongodb+srv://app_admin:Top$ecret99@mongo.internal/db');
  const sanitizedSrv = sanitizeError(srvError);
  assert.ok(!sanitizedSrv.message.includes('Top$ecret99'));
  assert.ok(sanitizedSrv.message.includes('mongodb+srv://***:***@mongo.internal/db'));

  // Object / rejection payload with connection URI
  const objectReason = {
    code: 'ECONNREFUSED',
    detail: 'Failed to reach mongodb://admin:hidden_pass@10.0.0.2:27017'
  };
  const sanitizedObj = sanitizeError(objectReason);
  assert.ok(!JSON.stringify(sanitizedObj).includes('hidden_pass'));
  assert.ok(sanitizedObj.detail.includes('mongodb://***:***@10.0.0.2:27017'));

  // Password in key-value string
  const kvError = 'Auth failed: password=SuperSecretToken on database';
  const sanitizedKv = sanitizeError(kvError);
  assert.ok(!sanitizedKv.includes('SuperSecretToken'));
  assert.ok(sanitizedKv.includes('password=***'));
});

test('Credential Sanitization: redacts secret-bearing values and sensitive URL query parameters across messages and stack traces', () => {
  // 1. HTTP and HTTPS URLs containing token, api_key, access_token, and refresh_token query parameters
  const urlMsg = 'Fetch error from https://api.service.internal/v1/events?token=sec_token_12345&region=us-east and http://external.provider:8080/callback?api_key=sk_live_998877&access_token=acc_443322&refresh_token=ref_112233#anchor';
  const sanitizedUrl = sanitizeError(urlMsg);
  assert.ok(!sanitizedUrl.includes('sec_token_12345'), 'token query param must be redacted');
  assert.ok(!sanitizedUrl.includes('sk_live_998877'), 'api_key query param must be redacted');
  assert.ok(!sanitizedUrl.includes('acc_443322'), 'access_token query param must be redacted');
  assert.ok(!sanitizedUrl.includes('ref_112233'), 'refresh_token query param must be redacted');
  assert.ok(sanitizedUrl.includes('https://api.service.internal/v1/events?token=***&region=us-east'), 'Non-sensitive params preserved');
  assert.ok(sanitizedUrl.includes('http://external.provider:8080/callback?api_key=***&access_token=***&refresh_token=***#anchor'), 'URL structure preserved');

  // 2. Passwords with quoted (single, double) and unquoted values
  const quotedDouble = sanitizeError('Config error: password: "DoubleQuotedPassword!123"');
  assert.ok(!quotedDouble.includes('DoubleQuotedPassword!123'));
  assert.ok(quotedDouble.includes('password: "***"'));

  const quotedSingle = sanitizeError("Config error: password: 'SingleQuotedPassword#456'");
  assert.ok(!quotedSingle.includes('SingleQuotedPassword#456'));
  assert.ok(quotedSingle.includes("password: '***'"));

  const unquoted = sanitizeError('Config error: password=UnquotedPassword789; status=active');
  assert.ok(!unquoted.includes('UnquotedPassword789'));
  assert.ok(unquoted.includes('password=***'));

  // 3. API keys, access tokens, refresh tokens, and secrets
  const secretsMsg = 'Payload: api_key="sk_test_abc123", access_token: "tok_xyz789", refresh_token: \'ref_000\', secret: "shhh_secret"';
  const sanitizedSecrets = sanitizeError(secretsMsg);
  assert.ok(!sanitizedSecrets.includes('sk_test_abc123'));
  assert.ok(!sanitizedSecrets.includes('tok_xyz789'));
  assert.ok(!sanitizedSecrets.includes('ref_000'));
  assert.ok(!sanitizedSecrets.includes('shhh_secret'));
  assert.ok(sanitizedSecrets.includes('api_key="***"'));
  assert.ok(sanitizedSecrets.includes('access_token: "***"'));
  assert.ok(sanitizedSecrets.includes("refresh_token: '***'"));
  assert.ok(sanitizedSecrets.includes('secret: "***"'));

  // 4. Authorization headers and Bearer / Basic credentials
  const authHeaderMsg = 'Failed request Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 and Basic dXNlcjpwYXNzd29yZA==';
  const sanitizedAuth = sanitizeError(authHeaderMsg);
  assert.ok(!sanitizedAuth.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
  assert.ok(!sanitizedAuth.includes('dXNlcjpwYXNzd29yZA=='));
  assert.ok(sanitizedAuth.includes('Authorization: Bearer ***'));
  assert.ok(sanitizedAuth.includes('Basic ***'));

  // 5. Error objects with stack traces containing sensitive values
  const complexError = new Error('HTTP 502 Bad Gateway while calling https://api.partner.com/v1/auth?token=raw_token_val&secret=sensitive_val with password="mySecret"');
  complexError.stack = `Error: HTTP 502 at https://api.partner.com/v1/auth?token=raw_token_val&secret=sensitive_val\n    at ClientRequest.onResponse (file:///app/service.js:42:15)\n    at Context.run (file:///app/worker.js:10:20)`;

  const cleanComplex = sanitizeError(complexError);
  assert.ok(!cleanComplex.message.includes('raw_token_val'));
  assert.ok(!cleanComplex.message.includes('sensitive_val'));
  assert.ok(!cleanComplex.message.includes('mySecret'));
  assert.ok(cleanComplex.message.includes('https://api.partner.com/v1/auth?token=***&secret=***'));
  assert.ok(cleanComplex.message.includes('password="***"'));

  assert.ok(cleanComplex.stack);
  assert.ok(!cleanComplex.stack.includes('raw_token_val'));
  assert.ok(!cleanComplex.stack.includes('sensitive_val'));
  assert.ok(cleanComplex.stack.includes('https://api.partner.com/v1/auth?token=***&secret=***'));
  assert.ok(cleanComplex.stack.includes('file:///app/service.js:42:15'), 'Stack trace file line preserved');
});

test('Request Logging Protection: prefers matched route pattern and never exposes sensitive path parameters or queries', () => {
  // 1. Matched subrouter route with parameter tokens in path
  const reqWithParams = {
    baseUrl: '/api',
    route: { path: '/users/:userId/tokens/:sessionToken' },
    originalUrl: '/api/users/usr_998877/tokens/sec_tok_1122334455?refresh=true&scope=all',
    path: '/api/users/usr_998877/tokens/sec_tok_1122334455',
    method: 'GET'
  };

  const matchedRoute = getRequestRoute(reqWithParams);
  assert.equal(matchedRoute, '/api/users/:userId/tokens/:sessionToken');
  assert.ok(!matchedRoute.includes('sec_tok_1122334455'), 'Sensitive path param value must not appear');
  assert.ok(!matchedRoute.includes('usr_998877'), 'User ID value must not appear in route pattern');
  assert.ok(!matchedRoute.includes('refresh=true'), 'Query parameters must not appear in route pattern');

  // 2. Matched root endpoint without subrouter
  const reqHealth = {
    baseUrl: '',
    route: { path: '/api/health' },
    originalUrl: '/api/health?probe=true',
    path: '/api/health',
    method: 'GET'
  };
  assert.equal(getRequestRoute(reqHealth), '/api/health');

  // 3. Matched subrouter endpoint without path parameters
  const reqEvents = {
    baseUrl: '/api',
    route: { path: '/events' },
    originalUrl: '/api/events?token=SECRET_API_KEY&userId=u_123',
    path: '/api/events',
    method: 'POST'
  };
  const eventsRoute = getRequestRoute(reqEvents);
  assert.equal(eventsRoute, '/api/events');
  assert.ok(!eventsRoute.includes('SECRET_API_KEY'));
});

test('Request Logging Protection: sanitizes sensitive path segments on unmatched fallback routes', () => {
  // 1. Unmatched path containing sensitive token prefix
  const reqTokenPath = {
    originalUrl: '/api/tokens/sk_live_1234567890abcdef?query=sensitive',
    path: '/api/tokens/sk_live_1234567890abcdef',
    method: 'GET'
  };
  const sanitizedToken = getRequestRoute(reqTokenPath);
  assert.equal(sanitizedToken, '/api/tokens/***');
  assert.ok(!sanitizedToken.includes('sk_live_1234567890abcdef'));
  assert.ok(!sanitizedToken.includes('query=sensitive'));

  // 2. Unmatched path with JWT token segment
  const reqJwtPath = {
    originalUrl: '/auth/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_hash_here/verify',
    path: '/auth/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature_hash_here/verify',
    method: 'POST'
  };
  const sanitizedJwt = getRequestRoute(reqJwtPath);
  assert.equal(sanitizedJwt, '/auth/***/verify');
  assert.ok(!sanitizedJwt.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));

  // 3. Unmatched path with 32-character hex token segment
  const reqHexPath = {
    originalUrl: '/reset/0123456789abcdef0123456789abcdef',
    path: '/reset/0123456789abcdef0123456789abcdef',
    method: 'GET'
  };
  const sanitizedHex = getRequestRoute(reqHexPath);
  assert.equal(sanitizedHex, '/reset/***');
  assert.ok(!sanitizedHex.includes('0123456789abcdef0123456789abcdef'));
});

test('Shutdown Reliability: promotes exit code to 1 when a fatal error races during graceful shutdown', async () => {
  // Helper to run a child process testing shutdown races
  const runChildRace = (triggerCode) => new Promise((resolveTest, rejectTest) => {
    const childCode = `
import { shutdown } from './server/src/index.js';

// 1. Initiate graceful shutdown with code 0 (emulating SIGINT/SIGTERM)
void shutdown('SIGINT', 0);

// 2. Trigger race event while shutdown is underway
${triggerCode}
`;

    const child = spawn(process.execPath, ['--input-type=module', '-e', childCode], {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      rejectTest(new Error('Child process timed out'));
    }, 8000);

    child.on('exit', (code) => {
      clearTimeout(timeout);
      resolveTest({ code, stdout, stderr });
    });
  });

  // Scenario 1: SIGINT followed by uncaughtException
  const uncaughtResult = await runChildRace('setImmediate(() => { throw new Error("Uncaught error during graceful shutdown"); });');
  assert.equal(uncaughtResult.code, 1, 'Process exit code must be promoted to 1 on uncaught exception');
  assert.ok(uncaughtResult.stdout.includes('Received SIGINT. Shutting down gracefully...'));
  assert.ok(uncaughtResult.stdout.includes('HTTP server and MongoDB connection closed.'));
  assert.ok(uncaughtResult.stderr.includes('Uncaught Exception thrown: Error: Uncaught error during graceful shutdown'));

  // Scenario 2: SIGINT followed by unhandledRejection
  const unhandledResult = await runChildRace('setImmediate(() => { Promise.reject(new Error("Unhandled rejection during graceful shutdown")); });');
  assert.equal(unhandledResult.code, 1, 'Process exit code must be promoted to 1 on unhandled rejection');
  assert.ok(unhandledResult.stdout.includes('Received SIGINT. Shutting down gracefully...'));
  assert.ok(unhandledResult.stdout.includes('HTTP server and MongoDB connection closed.'));
  assert.ok(unhandledResult.stderr.includes('Unhandled Promise Rejection: Error: Unhandled rejection during graceful shutdown'));
});
