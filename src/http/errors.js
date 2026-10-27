'use strict';

const { ValidationError, NotFoundError, ConflictError, ForbiddenError } = require('../domain/errors');
const { serializeError } = require('../logger');

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const DOMAIN_STATUS = [
  [ValidationError, 400, 'VALIDATION_ERROR'],
  [ForbiddenError, 403, 'FORBIDDEN'],
  [NotFoundError, 404, 'NOT_FOUND'],
  [ConflictError, 409, 'CONFLICT'],
];

/** Maps any error to { status, code, message, headers }. Unexpected errors never leak details to clients. */
function toHttpError(err, log) {
  if (err instanceof HttpError) return err;
  for (const [type, status, code] of DOMAIN_STATUS) if (err instanceof type) return new HttpError(status, code, err.message);
  if (err?.name === 'AgentRunError') {
    log?.error('agent_run_failed', { agent: err.agentKey, runId: err.runId, err: serializeError(err.cause) });
    return new HttpError(500, 'AGENT_RUN_FAILED', 'The agent run failed and was recorded; no partial output was kept.');
  }
  log?.error('unhandled_error', { err: serializeError(err) });
  return new HttpError(500, 'INTERNAL', 'The request could not be completed.');
}

module.exports = { HttpError, toHttpError };
