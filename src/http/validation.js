'use strict';

const { ValidationError } = require('../domain/errors');

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Optional/required trimmed string with length bounds; rejects non-strings instead of coercing objects. */
function text(body, field, { label = field, min = 0, max, required = false, fallback = '' } = {}) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ValidationError(`${label} is required.`, { field });
    return fallback;
  }
  if (typeof raw !== 'string' && typeof raw !== 'number') throw new ValidationError(`${label} must be text.`, { field });
  const value = String(raw).trim();
  if (value.length < min || value.length > max) throw new ValidationError(`${label} must be ${min}–${max} characters.`, { field });
  return value;
}

function optionalId(body, field, label) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !ID.test(raw)) throw new ValidationError(`${label} is not a valid identifier.`, { field });
  return raw;
}

/** Calendar date YYYY-MM-DD (rejects 2026-02-30). */
function optionalDate(body, field, label) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !DATE.test(raw)) throw new ValidationError(`${label} must be a date (YYYY-MM-DD).`, { field });
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
    throw new ValidationError(`${label} is not a valid date.`, { field });
  return raw;
}

function number(body, field, fallback = 0) {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && NUMERIC.test(raw.trim())) return Number(raw);
  return Number.NaN;
}

const isId = value => typeof value === 'string' && ID.test(value);

function parseMeeting(body) {
  return {
    title: text(body, 'title', { label: 'Meeting title', min: 3, max: 180, required: true }),
    briefingId: optionalId(body, 'briefingId', 'Briefing'),
    agenda: text(body, 'agenda', { label: 'Agenda', max: 20000 }),
    notes: text(body, 'notes', { label: 'Notes', max: 8000 }),
  };
}

function parseDecision(body) {
  const fields = {
    title: text(body, 'title', { label: 'Title', min: 3, max: 1000 }),
    decision: text(body, 'decision', { label: 'Decision', min: 3, max: 1000 }),
    owner: text(body, 'owner', { label: 'Owner', min: 2, max: 1000 }),
    expectedOutcome: text(body, 'expectedOutcome', { label: 'Expected outcome', min: 3, max: 1000 }),
  };
  if (!fields.title || !fields.decision || !fields.owner || !fields.expectedOutcome) {
    throw new ValidationError('Provide a title, decision, owner, and expected outcome.');
  }
  return {
    ...fields,
    dueDate: optionalDate(body, 'dueDate', 'Follow-up date'),
    findingId: optionalId(body, 'findingId', 'Finding'),
    meetingId: optionalId(body, 'meetingId', 'Meeting'),
  };
}

function parseOutcome(body) {
  const status = body.status === undefined || body.status === null || body.status === '' ? 'completed' : body.status;
  const actualOutcome = typeof body.actualOutcome === 'string' ? body.actualOutcome.trim() : '';
  if (actualOutcome.length < 3 || actualOutcome.length > 1000 || !['completed', 'reversed'].includes(status)) {
    throw new ValidationError('Provide an outcome and choose completed or reversed.');
  }
  return { actualOutcome, status };
}

const parseTaskCompletion = body => ({
  outcome: text(body, 'outcome', { label: 'Outcome', max: 1000, fallback: 'Completed and reviewed.' }),
});

function parseReview(body) {
  if (!['approved', 'rejected'].includes(body.decision)) throw new ValidationError('Decision must be approved or rejected.');
  return { decision: body.decision, note: text(body, 'note', { label: 'Note', max: 1000 }) };
}

const parseScenario = body => ({
  revenueChangePct: number(body, 'revenueChangePct'),
  expenseChangePct: number(body, 'expenseChangePct'),
  additionalHeadcount: number(body, 'additionalHeadcount'),
});

module.exports = { isId, text, optionalDate, parseMeeting, parseDecision, parseOutcome, parseTaskCompletion, parseReview, parseScenario };
