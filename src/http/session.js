'use strict';

const crypto = require('node:crypto');
const { findPersona } = require('../domain/permissions');

const COOKIE = 'cp_session';
const MAX_AGE_SECONDS = 12 * 3600;

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

/**
 * Signed demo-persona session (HMAC-SHA256, HttpOnly, SameSite=Strict). It proves which demo
 * persona the browser selected, not who the person is: real authentication is out of MVP scope.
 */
function createSessions({ secret, secure, now = Date.now }) {
  const key = secret ?? crypto.randomBytes(32).toString('hex');
  const sign = value => crypto.createHmac('sha256', key).update(value).digest('base64url');

  function issue(personaId) {
    const value = `${personaId}.${Math.floor(now() / 1000)}`;
    return `${value}.${sign(value)}`;
  }

  function verify(token) {
    if (typeof token !== 'string') return null;
    const [personaId, issuedAt, signature] = token.split('.');
    if (!personaId || !issuedAt || !signature) return null;
    const expected = Buffer.from(sign(`${personaId}.${issuedAt}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    if (now() / 1000 - Number(issuedAt) > MAX_AGE_SECONDS) return null;
    return findPersona(personaId);
  }

  const attributes = `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  return {
    fromRequest: req => verify(parseCookies(req.headers.cookie)[COOKIE]),
    setCookie: personaId => `${COOKIE}=${issue(personaId)}; Max-Age=${MAX_AGE_SECONDS}; ${attributes}`,
    clearCookie: () => `${COOKIE}=; Max-Age=0; ${attributes}`,
    ephemeralSecret: !secret,
  };
}

module.exports = { createSessions, parseCookies, COOKIE };
