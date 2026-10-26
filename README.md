# Company Pulse

**An executive operating workspace that turns company signals into explainable, owned, and measurable decisions.**

Company Pulse brings key indicators, data freshness, evidence-backed signals, agent recommendations, leadership decisions, and follow-through into one calm workspace. The product is designed around a simple loop: **notice → understand → decide → follow through → learn**.

> This repository contains a local MVP using a fictional company and simulated source data. Recommendations are deterministic examples. Approvals are recorded for demonstration and never trigger external actions. Do not use it with real company data.

## Product preview

The workspace starts with a suggested next step, makes each signal traceable to its evidence, and keeps every proposed action under human review. It includes six operating agents for company health, finance, commercial, operations, meeting preparation, and data quality.

## Try it locally

Requirements: Node.js 22 or newer. The app uses Node's built-in SQLite support and has no third-party runtime dependencies.

```bash
npm start
```

Open [http://localhost:3100](http://localhost:3100). To use a different port or database file, set `PORT` and `DATABASE_PATH`.

Run the tests:

```bash
npm test
```

## What's in the MVP

- Executive indicators across finance, commercial, operations, people, and data quality, with source and freshness metadata.
- Six deterministic agents that create findings, evidence, recommendations, follow-up tasks, and an executive briefing.
- A human review flow: inspect the rationale and suggested payload before approving or declining. Approval records intent only; it does not execute the action.
- Leadership meeting records, owned decisions, expected and actual outcomes, and an audit trail.
- A bounded scenario calculator that states its assumptions and leaves source data unchanged.
- Responsive executive workspace with signal filters, guided next step, accessible labels, and clear loading/error feedback.

## Architecture

The MVP is a small modular monolith: a built-in Node.js HTTP server, SQLite, deterministic agent services, and a dependency-free browser interface. See [`docs/`](docs/README.md) for the product requirements, architecture decisions, logical API/data model, security guardrails, and rollout gates.

## Important limitations

Authentication, authorization, tenant isolation, live connectors, production job processing, model-backed analysis, and external action execution are not implemented. The architecture documents describe future production requirements; they should not be interpreted as shipped security controls. Before any real-data pilot, implement and review the release gates in [`docs/security.md`](docs/security.md) and [`docs/testing-and-rollout.md`](docs/testing-and-rollout.md).

## License

MIT. See [`LICENSE`](LICENSE).
