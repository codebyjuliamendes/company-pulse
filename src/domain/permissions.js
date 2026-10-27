'use strict';

const ROLES = Object.freeze(['owner', 'executive', 'finance', 'department_lead', 'analyst', 'viewer']);

// Central permission map (deny by default). The UI only mirrors it; the server enforces it.
const PERMISSIONS = Object.freeze({
  'workspace.read': ROLES,
  'audit.read': ['owner', 'executive', 'finance', 'analyst'],
  'agents.run': ['owner', 'executive', 'finance', 'department_lead', 'analyst'],
  'proposals.review': ['owner', 'executive', 'finance'],
  'decisions.manage': ['owner', 'executive', 'finance', 'department_lead'],
  'meetings.manage': ['owner', 'executive'],
  'tasks.manage': ['owner', 'executive', 'finance', 'department_lead'],
  'scenarios.run': ['owner', 'executive', 'finance', 'analyst'],
});

// Fictional demo members, one per role. Selecting one is a demo of role-based access, not authentication.
const PERSONAS = Object.freeze([
  { id: 'elena', name: 'Elena Chen', title: 'Chief Executive Officer', role: 'owner' },
  { id: 'marcus', name: 'Marcus Bell', title: 'Chief Operating Officer', role: 'executive' },
  { id: 'ana', name: 'Ana Ribeiro', title: 'Chief Financial Officer', role: 'finance' },
  { id: 'priya', name: 'Priya Nair', title: 'VP Sales', role: 'department_lead' },
  { id: 'sam', name: 'Sam Okafor', title: 'Data Analyst', role: 'analyst' },
  { id: 'jordan', name: 'Jordan Lee', title: 'Board Observer', role: 'viewer' },
]);

const can = (role, permission) => Boolean(PERMISSIONS[permission]?.includes(role));
const permissionsFor = role => Object.keys(PERMISSIONS).filter(p => can(role, p));
const findPersona = id => PERSONAS.find(p => p.id === id) ?? null;

/** Actor as exposed to the API and written to the audit log. */
function actorFor(persona) {
  return { ...persona, actor: `user:${persona.id}`, permissions: permissionsFor(persona.role) };
}

module.exports = { ROLES, PERMISSIONS, PERSONAS, can, permissionsFor, findPersona, actorFor };
