'use strict';

const crypto = require('node:crypto');

const INCOMING_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Client IP honoring only the configured number of trusted proxy hops. */
function clientIp(req, trustProxy) {
  const remote = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return remote;
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return forwarded[forwarded.length - trustProxy] ?? forwarded[0] ?? remote;
}

/** Request id (propagates a valid X-Request-Id), per-request logger and JSON access log. */
function attachContext(req, res, { logger, trustProxy }) {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && INCOMING_ID.test(incoming) ? incoming : crypto.randomUUID();
  req.ip = clientIp(req, trustProxy);
  req.log = logger.child({ requestId: req.id });
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level]('request', {
      method: req.method,
      path: (req.url ?? '').split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(Number(process.hrtime.bigint() - start) / 1e6),
      actor: req.actor?.actor,
    });
  });
}

module.exports = { attachContext, clientIp };
