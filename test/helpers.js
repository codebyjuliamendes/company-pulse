'use strict';

const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');
const { seedDemoData } = require('../src/seed');
const { runAllAgents } = require('../src/agents');

/** In-process server over a seeded in-memory database. */
async function withServer(options, fn) {
  const db = openDatabase(':memory:');
  if (options.seed !== false) {
    seedDemoData(db, new Date('2026-10-26T12:00:00Z'));
    runAllAgents(db, { now: '2026-10-26T12:00:00Z' });
  }
  const server = createApp(db, options).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  try {
    await fn({ base, api, db, server });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }
}

module.exports = { withServer };
