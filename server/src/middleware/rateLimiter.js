// server/src/middleware/rateLimiter.js
// In-memory rate limiter for single-instance request burst mitigation.
// NOTE: This provides instance-local protection. For distributed multi-instance
// deployments, use a shared store (e.g. Redis) or an edge API Gateway.

export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 300;
  const skip = options.skip || ((req) => req.path === '/health' || req.path === '/api/health');

  const hits = new Map();

  // Periodic eviction of expired records every 60s
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (now > record.resetAt) {
        hits.delete(key);
      }
    }
  }, Math.min(windowMs, 60000));

  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  const rateLimiter = (req, res, next) => {
    if (skip(req)) {
      return next();
    }

    const key = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let record = hits.get(key);

    if (!record || now > record.resetAt) {
      record = {
        count: 1,
        resetAt: now + windowMs
      };
      hits.set(key, record);
    } else {
      record.count += 1;
    }

    const remaining = Math.max(0, max - record.count);
    const resetTimeSec = Math.ceil(record.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTimeSec);

    if (record.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSec);

      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later'
        }
      });
    }

    return next();
  };

  rateLimiter.reset = () => {
    hits.clear();
  };

  rateLimiter.stop = () => {
    clearInterval(cleanupInterval);
  };

  return rateLimiter;
}

export default createRateLimiter;
