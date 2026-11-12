// server/src/middleware/security.js
// Standard HTTP security headers without heavy external dependencies

export function securityHeaders(req, res, next) {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Prevent framing to mitigate clickjacking
  res.setHeader('X-Frame-Options', 'DENY');

  // Disable legacy browser XSS filter to prevent unintended client side vulnerabilities
  res.setHeader('X-XSS-Protection', '0');

  // Control referrer information sent in HTTP requests
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict resource loading policies for JSON API endpoints
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  // Enforce HTTPS via HSTS only when Express validates connection is secure or when in production
  if (req.secure || process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

export default securityHeaders;
