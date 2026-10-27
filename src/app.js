'use strict';

const http = require('node:http');
const path = require('node:path');
const { createLogger } = require('./logger');
const { createWorkspace } = require('./workspace');
const { can, findPersona, actorFor } = require('./domain/permissions');
const { HttpError, toHttpError } = require('./http/errors');
const { applySecurityHeaders, isAllowedOrigin } = require('./http/security');
const { attachContext } = require('./http/request-context');
const { createRateLimiter } = require('./http/rate-limit');
const { readJson, hasBody, isJson } = require('./http/body');
const { createSessions } = require('./http/session');
const { createStatic } = require('./http/static');
const { createRouter } = require('./http/router');
const { workspaceRoutes } = require('./routes/workspace');
const { agentRoutes } = require('./routes/agents');
const { executionRoutes } = require('./routes/execution');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sendJson(req, res, status, body, headers = {}) {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Cache-Control', 'no-store');
  if (status === 204 || body === undefined) {
    res.writeHead(status);
    return res.end();
  }
  const payload = JSON.stringify(body);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.writeHead(status);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

/**
 * Builds the HTTP server (not listening). Testable: pass an in-memory database.
 * @param db migrated node:sqlite connection
 * @param options.logger default silent
 * @param options.rateLimitPerMinute writes per IP per minute (0 disables)
 * @param options.agentRunsPerMinute agent runs per IP per minute (0 disables)
 * @param options.defaultPersona persona for requests without a session; null requires one
 */
function createApp(
  db,
  {
    logger = createLogger({ level: 'silent' }),
    rateLimitPerMinute = 0,
    agentRunsPerMinute = 0,
    trustProxy = 0,
    sessionSecret = null,
    cookieSecure = false,
    defaultPersona = 'elena',
    publicOrigin = null,
  } = {},
) {
  const workspace = createWorkspace(db);
  const sessions = createSessions({ secret: sessionSecret, secure: cookieSecure });
  const limiters = { writes: createRateLimiter({ limit: rateLimitPerMinute }), agents: createRateLimiter({ limit: agentRunsPerMinute }) };
  const serveStatic = createStatic(PUBLIC_DIR);
  const router = createRouter();
  workspaceRoutes(router, { workspace, sessions, db });
  agentRoutes(router, { workspace });
  executionRoutes(router, { workspace });

  const resolveActor = req => {
    const persona = sessions.fromRequest(req) ?? (defaultPersona ? findPersona(defaultPersona) : null);
    return persona ? actorFor(persona) : null;
  };

  async function handleApi(req, res, url) {
    const found = router.match(req.method, url.pathname);
    if (!found) throw new HttpError(404, 'NOT_FOUND', 'API route not found.');
    if (!found.route) throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { Allow: found.allowed.join(', ') });
    const { route, params } = found;

    let body = {};
    if (MUTATING.has(req.method)) {
      if (!isAllowedOrigin(req, publicOrigin)) throw new HttpError(403, 'CROSS_ORIGIN_REJECTED', 'Cross-origin requests are not allowed.');
      if (hasBody(req) && !isJson(req)) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the request body as application/json.');
      limiters.writes.check(req.ip, res);
      if (route.options.limiter === 'agents') limiters.agents.check(req.ip, res);
    }

    req.actor = resolveActor(req);
    if (!route.options.public) {
      if (!req.actor) throw new HttpError(401, 'UNAUTHENTICATED', 'Choose a demo persona to continue.');
      if (!can(req.actor.role, route.options.permission)) throw new HttpError(403, 'FORBIDDEN', 'Your role does not allow this action.');
    }
    if (MUTATING.has(req.method)) body = await readJson(req);

    const result = await route.handler({ req, res, params, body, query: url.searchParams, actor: req.actor, log: req.log });
    sendJson(req, res, result.status, result.body, result.headers);
  }

  const server = http.createServer(async (req, res) => {
    attachContext(req, res, { logger, trustProxy });
    applySecurityHeaders(res);
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return sendJson(req, res, 400, { error: 'Malformed request URL.', code: 'BAD_REQUEST', requestId: req.id });
    }
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.', { Allow: 'GET, HEAD' });
      if (await serveStatic(req, res, url.pathname)) return;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      const error = toHttpError(err, req.log);
      if (res.headersSent) return res.destroy();
      // Legacy contract: `error` stays a human-readable string; `code` and `requestId` are additive.
      sendJson(req, res, error.status, { error: error.message, code: error.code, requestId: req.id }, error.headers);
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.on('close', () => Object.values(limiters).forEach(l => l.stop()));
  server.workspace = workspace;
  server.sessions = sessions;
  return server;
}

module.exports = { createApp };
