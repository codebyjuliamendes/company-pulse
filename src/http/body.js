'use strict';

const { HttpError } = require('./errors');

const MAX_BODY_BYTES = 64 * 1024;

/** Reads a JSON object body with a byte limit. Empty body => {}. */
function readJson(req, { limit = MAX_BODY_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) {
      req.resume();
      return reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'));
    }
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = err => {
      if (done) return;
      done = true;
      reject(err);
    };
    req.on('data', chunk => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.'));
        return; // Keep draining (discarded) so the 413 response can be delivered.
      }
      chunks.push(chunk);
    });
    req.on('error', () => fail(new HttpError(400, 'BAD_REQUEST', 'The request body could not be read.')));
    req.on('end', () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      let value;
      try {
        value = JSON.parse(text);
      } catch {
        return reject(new HttpError(400, 'INVALID_JSON', 'The request body is not valid JSON.'));
      }
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return reject(new HttpError(400, 'INVALID_JSON', 'The request body must be a JSON object.'));
      resolve(value);
    });
  });
}

const hasBody = req => Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
const isJson = req => /^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? '');

module.exports = { readJson, hasBody, isJson, MAX_BODY_BYTES };
