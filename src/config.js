'use strict';

const path = require('node:path');

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'];

function int(env, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid ${name}: "${raw}" (integer between ${min} and ${max}).`);
  return value;
}

function bool(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no'].includes(raw.toLowerCase())) return false;
  throw new Error(`Invalid ${name}: "${raw}" (use 1/0 or true/false).`);
}

function origin(env, name) {
  const raw = env[name];
  if (!raw) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid ${name}: "${raw}" (expected an origin such as https://pulse.example.com).`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== raw.replace(/\/$/, '')) {
    throw new Error(`Invalid ${name}: "${raw}" (expected an origin such as https://pulse.example.com).`);
  }
  return parsed.origin;
}

/** Reads and validates the environment once, so misconfiguration fails at boot instead of at runtime. */
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const production = nodeEnv === 'production';
  const logLevel = env.LOG_LEVEL || 'info';
  if (!LOG_LEVELS.includes(logLevel)) throw new Error(`Invalid LOG_LEVEL: "${logLevel}" (${LOG_LEVELS.join(', ')}).`);

  const sessionSecret = env.SESSION_SECRET || null;
  if (sessionSecret && sessionSecret.length < 32) throw new Error('Invalid SESSION_SECRET: use at least 32 characters.');

  const defaultPersona = env.DEMO_DEFAULT_PERSONA === undefined ? 'elena' : env.DEMO_DEFAULT_PERSONA.trim() || null;

  return Object.freeze({
    env: nodeEnv,
    production,
    port: int(env, 'PORT', 3100, { min: 1, max: 65535 }),
    host: env.HOST || '0.0.0.0',
    databasePath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'company-pulse.sqlite'),
    logLevel,
    // Trusted proxy hops used to derive the client IP from X-Forwarded-For.
    trustProxy: int(env, 'TRUST_PROXY', 0, { min: 0, max: 10 }),
    rateLimitPerMinute: int(env, 'RATE_LIMIT_PER_MINUTE', 60, { min: 0 }),
    agentRunsPerMinute: int(env, 'AGENT_RUNS_PER_MINUTE', 12, { min: 0 }),
    sessionSecret,
    cookieSecure: bool(env, 'COOKIE_SECURE', production),
    // Persona used when a request carries no demo session; empty disables the fallback (401 instead).
    defaultPersona,
    publicOrigin: origin(env, 'PUBLIC_ORIGIN'),
    seedDemo: bool(env, 'SEED_DEMO', true),
  });
}

module.exports = { loadConfig, LOG_LEVELS };
