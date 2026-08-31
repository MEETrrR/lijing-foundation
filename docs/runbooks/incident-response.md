# Incident Response Runbook

## Purpose and guardrails

This runbook is for the Lijing API, workers, AI Gateway, platform dependencies, and client-facing release operations. Use China Standard Time (UTC+8) in the incident channel and record UTC timestamps in evidence files when a source uses UTC. The incident commander owns severity, priorities, and updates; the security owner owns suspected disclosure; the service owner owns recovery; and the scribe maintains the timeline.

Never paste passwords, access tokens, provider keys, database credentials, signed object-storage URLs, complete phone numbers, complete prompts, or complete conversation bodies into the incident channel, tickets, dashboards, screenshots, or evidence bundles. Record request IDs, event IDs, actor IDs, object IDs, reason codes, metric snapshots, hashes, versions, and sanitized error text instead.

## Severity

| Level | Use when | Initial response | Update target |
|---|---|---:|---:|
| P0 | Active data or secret exposure, uncontrolled AI spend, broad production outage, or loss of authoritative facts | 5 minutes | 15 minutes |
| P1 | Material production degradation, sustained 5xx, queue dead letters affecting user work, or a dependency failure with limited fallback | 15 minutes | 30 minutes |
| P2 | Localized errors, delayed non-critical work, noisy alerts, or a recoverable staging issue | 1 business hour | 4 hours |

Escalate when scope, cost, privacy impact, or recovery uncertainty increases. Downgrade only after the owner records the evidence and the incident commander agrees.

## First ten minutes

1. Declare the incident with severity, start time, incident commander, affected environment, and a short symptom statement.
2. Create a read-only evidence directory named with the incident ID and record the current application version, contract version, policy version, migration set, and deployment revision.
3. Capture dashboard snapshots for API success rate, P95/P99 latency, 5xx, rate limiting, queue backlog and dead letters, database connections, AI requests/tokens/cost, rejection/degradation, and client crashes.
4. Confirm whether the application, database, cache, queue, and object storage health states differ. Record only sanitized reason codes and latency.
5. Stop the source of harm first: disable the affected feature or AI route, pause a consumer, place the API in a read-only mode, or block a release. Record who approved the action and the exact configuration version.
6. Preserve logs, traces, usage-ledger rows, audit records, queue metadata, deployment metadata, and relevant hashes before cleanup or replay.
7. Start a timeline. Each entry has an ISO timestamp, actor, action, result, request or event ID, and evidence path.

## AI cost runaway or abuse

1. Treat a budget alert, unexpected token slope, repeated rejection bypass, or provider bill anomaly as P0 until bounded.
2. Enable the global AI kill switch or disable the affected feature at the server policy layer. Do not rely on a client release to stop requests.
3. Pause high-cost queues and provider routes. Keep a low-cost template fallback only if its policy, safety, and user messaging are already approved.
4. Compare request, input-token, output-token, actual-cost, rejection, cache-hit, and degradation metrics by environment, feature, model, policy version, and pseudonymous account/device dimensions. Do not export prompt or response bodies.
5. Confirm that local, staging, and production provider project IDs, credential references, budgets, and secret namespaces are distinct.
6. Preserve the AI usage ledger, budget decisions, audit events, request IDs, provider request references, and deployment/config hashes. Ask the provider for a billing hold or investigation using only approved references.
7. Rotate exposed provider credentials through the production secret manager, revoke the old version, verify the new reference, and run a synthetic canary with a bounded budget.
8. Restore traffic in stages. Keep the kill switch available and record the policy version and approver for every change.

## Queue backlog or dead letters

1. Identify the queue, consumer, event type, first failure time, backlog age, and dead-letter count from metrics and sanitized metadata.
2. Pause replay if the handler is failing deterministically or the event may cause duplicate state changes. Do not delete dead letters.
3. Check the consumer version, schema version, dependency health, retry count, and reason code. The expected retry budget is bounded; repeated delivery must not create duplicate facts, rewards, or notifications.
4. Fix or roll back the consumer in staging with synthetic events. Validate one successful event, one duplicate event, and one permanently failing event before production replay.
5. Replay only an approved time-bounded batch using the original event IDs and an audited operator identity. Keep the dead-letter snapshot and replay manifest.
6. Verify queue depth, processing latency, dead-letter rate, idempotency outcomes, and downstream ledger counts after replay.

## Database failure or connection exhaustion

1. Check the dependency health result, connection used/available metrics, error rate, migration state, and recent deployment. Do not include connection strings or provider error bodies in the incident record.
2. Stop non-essential workers and expensive reads. Preserve authoritative writes whenever their transaction and idempotency guarantees remain available.
3. If the database is unavailable, use the documented read-only or maintenance response. Never substitute cache data for authoritative rewards, mastery, energy, audit, or usage facts.
4. Check the last known good backup, replication state, migration compatibility, and restore approval. A restore or failover must preserve the evidence timeline and avoid rewriting append-only facts.
5. After recovery, run health checks, transaction and idempotency probes, queue reconciliation, and ledger count comparisons before reopening writes.

## Secret rotation

1. Classify the event as suspected exposure if a secret reached source, logs, traces, metrics, a client, a ticket, or an unapproved operator.
2. Preserve the access evidence and the redacted location. Do not copy the secret into the ticket for proof.
3. Revoke or disable the old version, issue a new version in the correct environment namespace, update the credential reference, and restart only the components that need the new version.
4. Verify local/staging/production resource identity, provider project, object storage signing key, queue credential, database credential, and Redis credential independently.
5. Run synthetic health and authorization checks, inspect access logs for use of the old version, and record the rotation version and timestamps.

## Rollback and release recovery

1. Prefer a reversible application or configuration rollback to rewriting data. Freeze unrelated changes and record the target revision, lockfile, contract version, policy version, and migration set.
2. Confirm backward compatibility between the target application and current database schema. Do not roll back past a migration unless the approved restore plan explicitly supports it.
3. Drain or pause affected consumers before changing their version. Keep event IDs, idempotency records, audit records, usage ledgers, rewards, mastery, and learning facts intact.
4. Deploy the target revision to a small production slice or health-check path. Verify application, database, cache, queue, object storage, API errors, and critical write idempotency.
5. Expand traffic only after the success rate, latency, queue state, and business fact reconciliation are stable. Record the rollback decision and follow-up corrective action.

## Evidence preservation and closure

Preserve the original alert, dashboard JSON or export, sanitized log and trace references, health reports, deployment and configuration hashes, secret-rotation audit, queue/dead-letter manifest, database backup or restore reference, and the incident timeline. Apply retention and access controls to the evidence directory and log every access.

The incident commander may close the incident after service recovery, owner handoff, evidence verification, user or regulator notification decisions, and a written root-cause and prevention plan. The follow-up must name the control, test, alert, runbook step, or rollback gate that will prevent recurrence.
