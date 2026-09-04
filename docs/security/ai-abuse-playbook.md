# AI Abuse Playbook

## Purpose

The AI Gateway is a cost, safety, and authorization boundary. No client, worker, or domain module may call a model provider directly. The default policy is stored in `packages/ai-policy/default-policy.yaml`; the values below are starting controls, not a permanent user entitlement.

## Default controls

| Control | Default | Enforcement point |
|---|---:|---|
| New account during first 24 hours | 5 AI requests per day | account risk and quota gate |
| Normal account | 20 AI requests per day | account quota gate |
| Burst | 3 requests per 10 minutes per account, device, and IP | sliding-window/tenant limiter |
| Per-user concurrency | 1 active request | reservation gate |
| Input | 4,000 tokens per request | normalized request gate |
| Output | 1,000 tokens per request | provider request and output validator |
| Images | 2 per request, 5 MB each | upload and AI request gate |
| Complex vision/long-context | 3 per day, preferably asynchronous | feature quota and queue gate |

The limits are evaluated independently across relevant dimensions. A request must pass all applicable gates; passing the account limit does not bypass the device, IP, feature, concurrency, or global budget limit.

## Required request path

1. **Identify:** authenticate the actor, account state, device summary, IP risk, client version, and any required age or safety mode.
2. **Authorize:** verify the user can use the requested feature and that the feature tier is available to that actor.
3. **Normalize:** assign a request ID, policy version, feature ID, prompt version, input type, attachment metadata, and a duplicate fingerprint. Do not put complete prompt or file content in logs.
4. **Limit:** apply account, device, IP, feature, concurrency, daily, monthly, and global budget controls. Reserve quota before queueing.
5. **Validate input:** enforce token, image count, image size, pixel, MIME, context, and source allowlists. Reject URLs or tools outside the allowlist.
6. **Execute:** use a provider adapter with bounded timeout and at most one retry for a known transient failure. Long or complex work enters the async queue.
7. **Validate output:** apply schema, sensitive-content, source/version, and tool-result checks. Unsafe, malformed, or unverifiable output is rejected or replaced with a safe fallback.
8. **Settle:** record estimated and actual tokens, cost, policy/model/prompt versions, cache/degradation state, and the final decision. Release unused reservations on failure, timeout, or cancellation.
9. **Respond:** return a safe result with request/trace identifiers, a stable reason code, and a retry hint. Never return provider credentials, internal prompts, stack traces, or hidden policy details.

## Signals and triage

Open an investigation when any of these signals persist for one evaluation window or cross the operating threshold approved for the environment:

- request or cost slope is materially above the expected cohort baseline;
- many accounts share a device/IP or many devices share one account;
- duplicate fingerprints, payload-mismatch idempotency conflicts, or concurrent requests rise sharply;
- rejection, timeout, output-validator, or provider-fallback rates change abruptly;
- complex-task usage reaches the daily ceiling for a cohort or global budget reservation fails;
- a prompt-injection regression, unauthorized tool attempt, or source-provenance failure is observed;
- a user report indicates private data, unsafe instructions, a wrong answer, or dependency on the assistant.

The first triage record must include UTC time, environment, affected feature, policy version, route, model/provider version, request IDs, aggregate counts, estimated cost, and the operator. It must exclude complete conversation bodies, model keys, access tokens, signed URLs, and complete phone numbers.

## Severity and actions

### P0: active data exposure or uncontrolled cost

Immediately disable the affected feature or provider route with the server kill switch, stop new reservations, keep login and confirmed learning records available, preserve the usage/audit ledger, revoke exposed credentials or URLs, and page the security and platform owners. Use the last known-good policy/prompt/provider route only after impact is bounded and approved.

### P1: material abuse, unsafe output, or broad quality failure

Rate-limit the actor/cohort, force async or low-cost fallback, quarantine the prompt/source/model version, freeze publication or reward effects that depend on the output, and start a bounded replay/evaluation. Roll back the smallest affected configuration and require security/content review before restoring it.

### P2: isolated suspicious request or user report

Reject or safely complete the request, record a reason code and minimized evidence, review the relevant output and source version, and add a regression case. Do not retain more sensitive content than the incident requires.

## Containment commands as capabilities

The implementation should expose audited server-side controls equivalent to:

- disable one AI feature, model route, provider, tool, or attachment type;
- reduce account/device/IP quotas and concurrency;
- force template, cached, low-cost, or async fallback;
- pause new quota reservations while allowing in-flight requests to settle or expire;
- quarantine a prompt, source, policy, or output version;
- revoke sessions, temporary upload access, or signed object access;
- roll back to a named policy/prompt/provider version.

Each control requires an authenticated operator, MFA for high-risk changes, an impact preview, a reason, an effective time, an expiry or recovery condition, and an immutable audit event. A kill switch must not be implemented as an undocumented database edit.

## Recovery checklist

1. Confirm the attack or failure is contained and that new reservations/cost are stable.
2. Compare the internal usage ledger with provider usage and identify missing or duplicated settlements.
3. Check whether unsafe output reached users, public content, retrieval indexes, analytics, or reward/progression decisions.
4. Revoke and rotate any exposed credentials, tokens, URLs, or temporary worker permissions.
5. Rebuild affected projections from authoritative facts; use compensating entries instead of rewriting history.
6. Restore a versioned configuration gradually, beginning with a small cohort and low-cost route.
7. Add a regression test/evaluation case and update the policy, detector, or runbook with an owner and review date.

## Governance

Every policy change is a new version with `effective_from`, optional `effective_until`, `updated_by`, `change_reason`, `change_ticket`, and rollback reference. The active policy is read by the server Policy & Configuration module; clients do not receive authoritative quotas and cannot override them.
