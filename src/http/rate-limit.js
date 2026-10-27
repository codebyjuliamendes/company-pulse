'use strict';

const { HttpError } = require('./errors');

/**
 * Fixed window per key (client IP), in memory. Enough for a single SQLite instance;
 * multiple instances would need a shared store.
 */
function createRateLimiter({ limit, windowMs = 60_000, now = Date.now, message = 'Too many requests. Wait a moment and try again.' }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const t = now();
    for (const [key, entry] of hits) if (entry.resetAt <= t) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return {
    /** Throws 429 when over the limit; sets RateLimit-* headers otherwise. */
    check(key, res) {
      if (!limit) return;
      const t = now();
      let entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        entry = { count: 0, resetAt: t + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
      if (entry.count > limit)
        throw new HttpError(429, 'RATE_LIMITED', message, { 'Retry-After': String(Math.ceil((entry.resetAt - t) / 1000)) });
    },
    stop: () => clearInterval(sweep),
  };
}

module.exports = { createRateLimiter };
