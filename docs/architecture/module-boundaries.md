# Module Boundaries

## Purpose

Lijing is a modular monolith, not a shared-database application. The monolith reduces deployment overhead while preserving ownership boundaries that can later be extracted into services. A module owns its domain facts, application use cases, validation, persistence mapping, events, and tests.

The rule is simple: **modules cannot write other modules' tables**. There is no shared business table, no cross-module SQL update, and no helper that accepts another module's repository as a shortcut.

## Runtime boundaries

```text
untrusted clients and admin UI
        |
versioned HTTP API / request context / authorization
        |
domain modules and application use cases
        |             |              |
owned facts     versioned events  adapter interfaces
        |             |              |
PostgreSQL     message bus       Redis/object storage/AI providers
```

The API exposes use cases, not persistence structures. Workers consume events and call application interfaces. Redis, object storage, queues, and model providers are replaceable adapters; none is the sole source of a business fact.

## Ownership map

| Module | Owns | May synchronously depend on | Must not write |
|---|---|---|---|
| Identity | accounts, sessions, devices, roles, authentication risk | platform security, compliance | profile, reward, or AI usage facts |
| Policy & Configuration | feature flags, quota policies, rule versions, kill switches | platform, audit | identity or domain ledgers |
| User Profile | goals, exam dates, preferences, consent state | Identity | authentication credentials or learning results |
| Exam & Knowledge | exams, subjects, chapters, stable knowledge-point identities | platform | content review outcomes or mastery state |
| Content | question/content versions, sources, copyright, review state | Exam & Knowledge, Trust & Safety interfaces | answer attempts or rewards |
| Assessment | attempts, answer evaluation, assessment reports | Content, Exam & Knowledge | mastery, reward, or client balances |
| Mastery | knowledge-point state and rule-versioned transitions | Assessment events | raw attempts or review tasks |
| Review | review schedules and completion facts | User Profile; `MasteryUpdated` events | mastery state or raw attempts |
| Planning | daily plans, time blocks, plan revisions | User Profile, Mastery, Review projections | answer correctness or rewards |
| Quest & Boss | quest state, boss attempts, completion facts | Content, Assessment, Mastery projections | progression balances |
| Progression | EXP, level, titles, reward ledger, settlement rules | Quest & Boss, Mastery events | economy balances or client claims |
| Economy | currency, energy, item, and entitlement ledgers | Progression, Identity | mastery or reward source facts |
| AI Gateway | normalized AI requests, quota reservations, usage/cost ledger, provider routing | Identity, Policy & Configuration, Trust & Safety policy interface | provider credentials or domain tables |
| Trust & Safety | risk decisions, reports, moderation cases, security audit records | Identity, Content; security events | learning facts or balances |
| Analytics & Evidence | read-only projections, metric versions, evidence exports | domain events | source facts in any module |
| Notification | delivery intents, preference-aware dispatch state, frequency control | User Profile, Planning | plan or profile facts |
| Experience Runtime | presentation state, asset references, animation lifecycle | client projections and presentation events | server state, rewards, mastery, or energy |

The table is a dependency guide, not permission to import another module's persistence layer. A listed dependency means an interface, a stable projection, or a versioned event, not a foreign repository.

## Communication rules

Use a synchronous application interface when the caller needs a bounded result before responding, such as evaluating one answer or reading current progress. Use a versioned event when the work can be retried, processed asynchronously, or consumed by multiple modules, such as `MasteryUpdated`, `RewardGranted`, or `AiRequestRejected`.

Every event carries the envelope defined in `packages/contracts/events/event-envelope.schema.json`. Consumers must be idempotent by `event_id`, tolerate reordered delivery where the event contract permits it, and record a dead-letter reason after bounded retries.

The core direction of flow is:

```text
Assessment -> Mastery -> Review -> Planning
Assessment/Mastery/Quest -> Progression -> Economy
Identity + Policy -> AI Gateway -> provider adapter
All modules -> events -> Analytics & Evidence
```

This avoids a circular hard dependency between mastery and review. Experience Runtime consumes confirmed presentation events; animation completion never changes a business result.

## Server authority

The client can submit intent: a selected answer, a quest action, an AI use case, or an upload request. The server determines authorization, timing, validity, correctness, mastery, rewards, energy, quotas, and final state. Client-provided fields such as `reward`, `mastery`, `energy`, `correct`, `balance`, `server_time`, or `completed` are rejected when they would assert a server-owned result.

The admin UI is also an untrusted client from the API's perspective. Administrative permissions, MFA, high-risk confirmation, dual approval, scope checks, and audit writes happen server-side.

## Boundary review checklist

Before a new module or endpoint is accepted, the change must name:

- the owning module and tables/facts it alone can mutate;
- the synchronous interface or event used by each dependency;
- the request ID, idempotency, authorization, quota, and audit behavior;
- the data classification and log-redaction behavior;
- the rollback, kill switch, retry, and dead-letter path;
- the tests proving a client cannot submit the final business result.
