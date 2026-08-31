# Lijing (砺境) Foundation

This repository is the security, contract, and operating baseline for Lijing, a China-mainland RPG gamified AI learning platform. The first implementation task deliberately establishes boundaries before business modules are added.

## Non-negotiable rules

- Clients are untrusted. A client may request an action, but it cannot assert the result of that action.
- Rewards, mastery, and energy are server-settled. The server owns the state machine, ledger entry, rule version, and idempotency decision.
- AI is only reachable through the server AI Gateway. Clients and domain modules never call model providers directly and never receive provider credentials.
- Modules cannot write other modules' tables. A module owns its facts; other modules use versioned APIs or domain events.
- Production secrets never belong in source, logs, or clients. This includes passwords, access tokens, model keys, signing keys, and private connection details.

These rules apply to the mobile/Web user clients, the admin Web client, API handlers, workers, scripts, tests, and operational tooling.

## Repository boundary

The production target is a modular monolith with replaceable adapters:

```text
apps/                 user_client and admin_web
services/api/         NestJS API and domain modules
packages/contracts/   OpenAPI and JSON Schema contracts
packages/ai-policy/   versioned server-side AI policy defaults
infra/                environment, deployment, storage, and observability definitions
docs/                 architecture, security, runbooks, and evidence guidance
tests/                contract, unit, integration, security, load, and evaluation tests
```

The module boundaries are documented in `docs/architecture/module-boundaries.md`. This branch contains the baseline artifacts; later tasks add runtime code inside those boundaries.

## Contract rules

- HTTP endpoints use the `/api/v1` base path. Breaking changes require a new API major version or an explicitly approved compatibility window.
- Every request has a traceable `request_id`. Every state-changing request also requires an `Idempotency-Key`.
- API contracts describe use cases and domain representations. They do not expose database tables, SQL, provider SDKs, or internal ledger layouts.
- Domain events use the stable envelope in `packages/contracts/events/event-envelope.schema.json`.
- A write must be safe to retry: the server returns the original result for the same actor, route, and idempotency key, and rejects a reused key with a different payload.

## Security baseline

The threat model, AI abuse response path, data classification, and environment isolation rules are in:

- `docs/security/threat-model.md`
- `docs/security/ai-abuse-playbook.md`
- `docs/security/data-classification.md`
- `infra/environments/environment-matrix.md`

The default AI limits are configuration data, not client promises. They are versioned, effective-dated, auditable, server-configurable, and subject to a kill switch. A policy change must include an approver, a reason, an effective time, and a rollback version.

## Contract lint

This repository intentionally has no dependency installation requirement for the initial baseline. Run from the repository root:

```text
node --no-warnings --experimental-strip-types --test tests/contract/contract-lint.test.ts
```

The command validates the OpenAPI version/write metadata, the required event envelope fields, and the AI policy limits and governance fields. It is deterministic and exits non-zero when a required file or field is missing.

## Development rules

1. Define the owning module, use case, request context, event, audit fields, quota, rollback path, and kill switch before adding a feature.
2. Keep business facts in the owning module. Cross-module reads use an explicit interface or read projection; cross-module writes are prohibited.
3. Treat uploaded files, retrieved content, user prompts, client timestamps, reward claims, and model output as untrusted input.
4. Keep sensitive data out of logs. Log identifiers, classifications, reason codes, sizes, versions, and hashes where useful, never secrets or complete sensitive content.
5. Use test-first changes for runtime behavior. Contract and configuration checks must fail for missing required fields rather than silently accepting an incomplete baseline.
6. Prefer forward-compatible migrations, append-only facts, idempotent consumers, bounded retries, private object storage, and reversible configuration.

## Scope note

This baseline is not a claim that the product is production-ready. It is the gate that later identity, learning, progression, AI, client, admin, observability, and release work must satisfy. Mainland China legal, regulatory, content, copyright, and data-transfer review remains an explicit pre-launch responsibility for qualified professionals.
