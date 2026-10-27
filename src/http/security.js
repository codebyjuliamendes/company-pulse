'use strict';

// No 'unsafe-inline': all scripts and styles are external files (theme.js applies the theme before paint).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const HEADERS = Object.freeze({
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
});

function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(HEADERS)) res.setHeader(name, value);
}

/**
 * CSRF defense for cookie/default-persona requests: a browser always sends Origin on
 * cross-origin writes, so a mismatch (or the opaque "null" origin) is refused.
 */
function isAllowedOrigin(req, publicOrigin) {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // Non-browser clients (curl, tests) and same-origin navigations.
  if (publicOrigin) return origin === publicOrigin;
  const host = req.headers.host;
  return Boolean(host) && (origin === `http://${host}` || origin === `https://${host}`);
}

module.exports = { CSP, applySecurityHeaders, isAllowedOrigin };
