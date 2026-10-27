'use strict';

const { version } = require('../../package.json');
const { SCHEMA_VERSION, schemaVersion } = require('../db');
const { findPersona, actorFor, PERSONAS } = require('../domain/permissions');
const { listAgents } = require('../agents');
const { HttpError } = require('../http/errors');

function workspaceRoutes(router, { workspace, sessions, db }) {
  router.add('GET', '/api/health', { public: true }, () => {
    // Touches the database so a broken volume or lock surfaces as unhealthy.
    workspace.store.ping();
    return { status: 200, body: { status: 'ok', version, schemaVersion: schemaVersion(db), expectedSchemaVersion: SCHEMA_VERSION } };
  });

  router.add('GET', '/api/session', { public: true }, ({ actor }) => ({ status: 200, body: { viewer: actor, personas: PERSONAS } }));

  // Switches the demo persona. This demonstrates role-based access; it is not authentication.
  router.add('POST', '/api/session', { public: true, write: true }, ({ body, log }) => {
    const persona = typeof body.personaId === 'string' ? findPersona(body.personaId) : null;
    if (!persona) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose one of the demo personas.');
    log.info('persona_selected', { persona: persona.id, role: persona.role });
    return { status: 200, body: { viewer: actorFor(persona) }, headers: { 'Set-Cookie': sessions.setCookie(persona.id) } };
  });

  router.add('DELETE', '/api/session', { public: true, write: true }, () => ({
    status: 204,
    headers: { 'Set-Cookie': sessions.clearCookie() },
  }));

  router.add('GET', '/api/dashboard', { permission: 'workspace.read' }, ({ actor }) => ({ status: 200, body: workspace.dashboard(actor) }));
  router.add('GET', '/api/agents', { permission: 'workspace.read' }, () => ({ status: 200, body: listAgents() }));
  router.add('GET', '/api/audit', { permission: 'audit.read' }, ({ query }) => {
    const limit = Math.min(Math.max(Number.parseInt(query.get('limit') ?? '80', 10) || 80, 1), 200);
    return { status: 200, body: workspace.audit(limit) };
  });
}

module.exports = { workspaceRoutes };
