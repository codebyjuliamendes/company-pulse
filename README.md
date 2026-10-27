# Company Pulse

**An executive operating workspace that turns company signals into explainable, owned and measurable decisions.**

Company Pulse brings key indicators, data freshness, evidence-backed signals, agent recommendations, leadership decisions and follow-through into one calm workspace, built around one loop: **signal → evidence → recommendation → human review → owned action → outcome**.

> This repository is a local MVP with a fictional company (Northstar Systems) and simulated sources. Recommendations come from deterministic rules. Approval creates an internal follow-up and never triggers an external action. Do not use it with real company data.

## Features

- **Indicators with lineage** — finance, commercial, operations, people (aggregate only) and data quality, each with definition, target, prior period, source, observation time, freshness and confidence. Status is never shown by color alone.
- **Six bounded agents** — Company Health, Finance, Commercial, Operations, Meeting Prep and Data Quality. Each signal cites the rule that fired, the compared values and the metric evidence; stale or low-confidence sources lower confidence and are stated as caveats.
- **Human review** — recommendations wait for an authorized person. Approval creates the proposed internal task in the same transaction as its audit event; rejection has no side effect. Re-running agents never duplicates pending work.
- **Decisions and meetings** — owned decisions with expected and actual outcome, meeting briefs saved with their source briefing, follow-up tasks.
- **Roles** — six fictional personas, one per documented role (owner, executive, finance, department lead, analyst, viewer), enforced server-side.
- **Audit trail** — append-only history of agent output, reviews, decisions and tasks, with actor and request id.
- **Scenario calculator** — explicit, bounded assumptions; never changes source data.
- **Interface** — responsive down to 390 px, light/dark theme (system or manual), keyboard accessible, loading/error/empty states, no inline scripts or styles.

## Run locally

Requires **Node.js 22.13 or newer** (uses the built-in `node:sqlite`; no third-party runtime dependencies).

```bash
npm install   # dev tooling only (ESLint, Prettier)
npm start
```

Open <http://localhost:3100>. On first boot the database is created in `data/company-pulse.sqlite`, the fictional company is seeded and every agent runs once. To start over, stop the server and delete that file.

### Scripts

```bash
npm run dev            # restart on file changes
npm test               # node:test suites (domain, agents, database, API, infra, real server)
npm run lint           # ESLint 9 (flat config)
npm run format         # Prettier
npm run format:check
npm run check          # lint + format check + tests — the same gate as CI
```

### Environment variables

Validated at boot; an invalid value stops the process with a clear message. Template: [`.env.example`](.env.example).

| Variable                | Default                     | Description                                                                |
| ----------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `PORT`                  | `3100`                      | HTTP port.                                                                 |
| `HOST`                  | `0.0.0.0`                   | Bind address.                                                              |
| `DATABASE_PATH`         | `data/company-pulse.sqlite` | SQLite file (directory is created).                                        |
| `LOG_LEVEL`             | `info`                      | `debug`, `info`, `warn`, `error` or `silent`.                              |
| `TRUST_PROXY`           | `0`                         | Proxy hops trusted for `X-Forwarded-For`.                                  |
| `RATE_LIMIT_PER_MINUTE` | `60`                        | API writes per IP per minute; `0` disables.                                |
| `AGENT_RUNS_PER_MINUTE` | `12`                        | Agent runs per IP per minute; `0` disables.                                |
| `SESSION_SECRET`        | random per boot             | ≥ 32 characters; signs the demo-persona cookie.                            |
| `COOKIE_SECURE`         | `1` in production, else `0` | Adds `Secure` to the session cookie.                                       |
| `DEMO_DEFAULT_PERSONA`  | `elena`                     | Persona for requests without a session; empty requires choosing one (401). |
| `PUBLIC_ORIGIN`         | —                           | When set, writes must come exactly from this origin.                       |
| `SEED_DEMO`             | `1`                         | Seed the fictional company and run agents on first boot.                   |

## Project structure

```
src/
  server.js          entry point: config, logger, database, HTTP server, graceful shutdown
  app.js             createApp(db, options) — testable http.Server factory
  config.js          validated environment
  logger.js          JSON logger (one line per event)
  db.js, seed.js     node:sqlite connection, versioned migrations, transactions, demo fixtures
  store.js           all SQL (prepared statements)
  workspace.js       application services (meetings, decisions, tasks, dashboard)
  agents.js          agent orchestrator, run lifecycle, proposal review
  domain/            pure rules: metric catalog, thresholds, briefing, scenario, permissions
  http/              router, body limits, errors, security headers, session, rate limit, static files
  routes/            HTTP routes by area
public/              HTML, CSS tokens (light/dark), theme.js, app.js — no framework, no build step
test/                node:test suites
docs/                PRD, architecture and ADRs, data and API, security, testing and rollout
```

## Architecture

A modular monolith (see [`docs/architecture.md`](docs/architecture.md)): routes validate input and call services; services run each command — write plus audit event — in one SQLite transaction; deterministic domain modules own every number and threshold. Agents only propose; a separate review step is the only path to an (internal) side effect. Zero runtime dependencies is a deliberate decision (ADR-006).

## API

All routes are under `/api`, JSON in and out. Errors: `{ "error": "message", "code": "VALIDATION_ERROR", "requestId": "…" }`. Writes require `Content-Type: application/json` and a same-origin request.

| Route                                                              | Purpose                                          |
| ------------------------------------------------------------------ | ------------------------------------------------ |
| `GET /api/health`                                                  | Liveness plus database and schema version.       |
| `GET/POST/DELETE /api/session`                                     | Read or switch the demo persona.                 |
| `GET /api/dashboard`                                               | Full workspace read model.                       |
| `GET /api/agents` · `GET /api/audit`                               | Agent metadata · audit trail (newest first).     |
| `POST /api/agents/run` · `POST /api/agents/:key/run`               | Run all / one agent; optional `Idempotency-Key`. |
| `POST /api/proposals/:id/review`                                   | `{ "decision": "approved" \| "rejected" }`.      |
| `POST /api/meetings` · `POST /api/decisions`                       | Save a meeting brief · record a decision.        |
| `POST /api/decisions/:id/outcome` · `POST /api/tasks/:id/complete` | Record an outcome · complete a follow-up.        |
| `POST /api/scenarios/preview`                                      | Illustrative scenario (read-only).               |

Permissions per route and full payloads: [`docs/data-and-api.md`](docs/data-and-api.md#implementation-status-current-slice).

## Production

```bash
docker compose up --build    # http://localhost:3100, data in the company-pulse-data volume
```

The image has a test stage (runs `npm run check`) and a runtime stage that runs as a non-root user, stores the database on the `/data` volume and declares a `HEALTHCHECK` on `/api/health`. SIGTERM triggers a graceful shutdown (in-flight requests finish, database closes, 10 s cap).

- Run **one instance** per database file: SQLite and the in-memory rate limiter are single-node.
- Terminate TLS at a reverse proxy and set `TRUST_PROXY=1`, `COOKIE_SECURE=1`, `PUBLIC_ORIGIN` and a fixed `SESSION_SECRET`.
- Back up the database with SQLite's online backup (e.g. `sqlite3 company-pulse.sqlite ".backup backup.sqlite"`); WAL mode keeps the copy consistent while the app runs.
- Logs are JSON lines with `requestId` (propagated from `X-Request-Id` when valid).

CI runs lint, format check, tests and `npm audit` on Node 22 and 24, builds the image and smoke-tests the container. Dependabot opens weekly npm and monthly Actions/Docker updates.

## Limitations

- **Not authentication.** Personas demonstrate role-based authorization; anyone who can reach the app can pick any persona. Real login, sessions and tenant isolation are out of MVP scope.
- Single fictional workspace; simulated sources only — no live connectors or imports.
- Approval executes only internal task creation; no Tier C (external or financial) executor exists.
- Not yet implemented from the target spec: `/api/v1` contracts and pagination, approval expiry, per-role filtering of finance values, money as integer minor units, an automated browser E2E suite in CI.

See [`docs/security.md`](docs/security.md) and [`docs/testing-and-rollout.md`](docs/testing-and-rollout.md) for the gates required before any real-data pilot.

## License

MIT. See [`LICENSE`](LICENSE).
