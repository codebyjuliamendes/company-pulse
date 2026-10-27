'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/logger');
const { createSessions } = require('../src/http/session');
const { createRateLimiter } = require('../src/http/rate-limit');
const { clientIp } = require('../src/http/request-context');
const { withServer } = require('./helpers');

test('config: defaults and validation at boot', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3100);
  assert.equal(config.rateLimitPerMinute, 60);
  assert.equal(config.defaultPersona, 'elena');
  assert.equal(config.cookieSecure, false);
  assert.equal(loadConfig({ NODE_ENV: 'production' }).cookieSecure, true);
  assert.equal(loadConfig({ DEMO_DEFAULT_PERSONA: '' }).defaultPersona, null);
  assert.throws(() => loadConfig({ PORT: 'abc' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ LOG_LEVEL: 'verbose' }), /Invalid LOG_LEVEL/);
  assert.throws(() => loadConfig({ SESSION_SECRET: 'short' }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'https://x.test/path' }), /PUBLIC_ORIGIN/);
  assert.throws(() => loadConfig({ COOKIE_SECURE: 'maybe' }), /COOKIE_SECURE/);
});

test('logger: one JSON line per event, honors level and inherits bindings', () => {
  const lines = [];
  const logger = createLogger({ level: 'info', write: line => lines.push(JSON.parse(line)) }).child({ requestId: 'abc' });
  logger.debug('hidden');
  logger.warn('visible', { status: 404 });
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].level, lines[0].msg, lines[0].requestId, lines[0].status], ['warn', 'visible', 'abc', 404]);
});

test('access log carries the propagated request id and the acting persona', async () => {
  const lines = [];
  const logger = createLogger({ write: line => lines.push(JSON.parse(line)) });
  await withServer({ logger }, async ({ api }) => {
    const res = await api('/api/dashboard', { headers: { 'x-request-id': 'req-12345678' } });
    assert.equal(res.headers.get('x-request-id'), 'req-12345678');
    const generated = await api('/api/health', { headers: { 'x-request-id': 'bad id with spaces' } });
    assert.match(generated.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  });
  const entry = lines.find(l => l.msg === 'request' && l.path === '/api/dashboard');
  assert.deepEqual([entry.requestId, entry.status, entry.actor], ['req-12345678', 200, 'user:elena']);
  assert.equal(typeof entry.durationMs, 'number');
});

test('sessions: signed, tamper-evident and expiring', () => {
  let now = Date.now();
  const sessions = createSessions({ secret: 'x'.repeat(32), secure: true, now: () => now });
  const cookie = sessions.setCookie('ana');
  assert.match(cookie, /HttpOnly; SameSite=Strict; Secure/);
  const req = c => ({ headers: { cookie: c } });
  const value = cookie.split(';')[0];
  assert.equal(sessions.fromRequest(req(value)).id, 'ana');
  assert.equal(sessions.fromRequest(req(value.replace('ana.', 'elena.'))), null);
  const other = createSessions({ secret: 'y'.repeat(32), secure: false });
  assert.equal(other.fromRequest(req(value)), null);
  now += 13 * 3600 * 1000;
  assert.equal(sessions.fromRequest(req(value)), null);
});

test('rate limiter: fixed window per key', () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, now: () => now });
  const res = { setHeader() {} };
  limiter.check('a', res);
  limiter.check('a', res);
  assert.throws(
    () => limiter.check('a', res),
    err => err.status === 429 && Number(err.headers['Retry-After']) === 60,
  );
  limiter.check('b', res);
  now = 60_000;
  limiter.check('a', res);
  limiter.stop();
});

test('client IP honors only the configured proxy hops', () => {
  const req = { socket: { remoteAddress: '10.0.0.1' }, headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' } };
  assert.equal(clientIp(req, 0), '10.0.0.1');
  assert.equal(clientIp(req, 1), '2.2.2.2');
  assert.equal(clientIp(req, 2), '1.1.1.1');
});
