'use strict';

const { loadConfig } = require('./config');
const { createLogger, serializeError } = require('./logger');
const { openDatabase } = require('./db');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger({ level: config.logLevel, bindings: { service: 'company-pulse' } });
const db = openDatabase(config.databasePath);
const server = createApp(db, {
  logger,
  rateLimitPerMinute: config.rateLimitPerMinute,
  agentRunsPerMinute: config.agentRunsPerMinute,
  trustProxy: config.trustProxy,
  sessionSecret: config.sessionSecret,
  cookieSecure: config.cookieSecure,
  defaultPersona: config.defaultPersona,
  publicOrigin: config.publicOrigin,
});
if (config.seedDemo) server.workspace.ensureDemo({ logger });
if (server.sessions.ephemeralSecret && config.production)
  logger.warn('session_secret_missing', { hint: 'Set SESSION_SECRET so demo sessions survive restarts.' });

server.listen(config.port, config.host, () =>
  logger.info('server_started', { port: config.port, env: config.env, url: `http://localhost:${config.port}` }),
);

let stopping = false;
function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info('shutdown', { signal });
  server.close(() => {
    db.close();
    logger.info('shutdown_complete');
    process.exit(0);
  });
  server.closeIdleConnections();
  setTimeout(() => {
    logger.error('shutdown_timeout');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', reason => logger.error('unhandled_rejection', { err: serializeError(Object(reason)) }));
process.on('uncaughtException', err => {
  logger.error('uncaught_exception', { err: serializeError(err) });
  process.exit(1);
});
