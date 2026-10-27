'use strict';

const { LOG_LEVELS } = require('./config');

/** JSON logger, one line per event, ready for log aggregators. */
function createLogger({ level = 'info', bindings = {}, write = line => process.stdout.write(line + '\n') } = {}) {
  const threshold = LOG_LEVELS.indexOf(level);
  const log = (lvl, msg, fields) => {
    if (LOG_LEVELS.indexOf(lvl) < threshold) return;
    write(JSON.stringify({ time: new Date().toISOString(), level: lvl, msg, ...bindings, ...fields }));
  };
  return {
    debug: (msg, fields) => log('debug', msg, fields),
    info: (msg, fields) => log('info', msg, fields),
    warn: (msg, fields) => log('warn', msg, fields),
    error: (msg, fields) => log('error', msg, fields),
    child: extra => createLogger({ level, bindings: { ...bindings, ...extra }, write }),
  };
}

const serializeError = err => ({ name: err?.name, message: err?.message, code: err?.code, stack: err?.stack });

module.exports = { createLogger, serializeError };
