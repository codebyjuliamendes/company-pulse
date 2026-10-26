# Company Pulse — product and engineering docs

Source of truth for the full Company Pulse MVP: an executive operating hub that turns company signals into explainable, owned, and tracked decisions with bounded AI-agent automation.

- [PRD](./PRD.md): users, scope, workflows, agents, roles, and acceptance criteria.
- [Architecture and ADRs](./architecture.md): modules, data flows, and engineering decisions.
- [Security and guardrails](./security.md): threat model, authorization, approval tiers, privacy, audit.
- [Data model and API](./data-and-api.md): logical schema, REST contracts, examples.
- [Testing and rollout](./testing-and-rollout.md): quality gates, evaluation, rollout sequence.

**Current implementation:** a local, single-workspace demonstration with fictional data, six deterministic agents, evidence-linked findings, proposal review, meetings, owned decisions with outcome capture, follow-up tasks, audit history, and a bounded scenario calculator. It has no login, tenant isolation, live business connectors, or external action execution.

**Target MVP specification:** the documents describe the complete intended product boundary and its production gates. Architecture diagrams and API contracts include planned identity, connector, policy, and job abstractions; they are not all implemented in this local slice. Treat the security checklist and rollout gates as required work before real company data or customer use.

**Invariant:** every material insight exposes source and freshness; every proposed action has policy and ownership; consequential actions require human approval; decisions and outcomes are auditable. Demo data and connectors are simulated; real integrations and external side effects are excluded.
