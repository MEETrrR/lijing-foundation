# Data Classification and Logging Redaction

## Principles

Collect the minimum data needed for a declared product, security, support, or evidence purpose. Every field has an owner, purpose, access scope, retention rule, and deletion/anonymization path. A useful identifier is not permission to expose the underlying value.

Production data must not be copied into local or staging environments without an approved, irreversible de-identification process. Analytics and competition evidence use aggregate or pseudonymous records and retain the metric, source event, calculation version, and data range.

## Classification levels

| Level | Meaning | Examples | Required handling |
|---|---|---|---|
| L0 Public | Intended for anyone to see after publication. | Published course text, public product status, approved static assets. | Review before publication; integrity and copyright still apply. |
| L1 Internal | Operational data whose disclosure is low impact but not public. | Service health, coarse metrics, content workflow counts, non-sensitive configuration names. | Authenticated staff access; do not place in public responses or client bundles by default. |
| L2 Confidential | Personal, behavioral, business, or unpublished content data. | Account identifiers, masked contact details, device summaries, learning facts, AI request metadata, uploads in quarantine, unpublished questions, support cases. | Least privilege, encryption in transit/at rest, purpose-limited access, audited reads, redacted logs, controlled export, defined retention. |
| L3 Restricted | Secrets or data where compromise creates direct account, infrastructure, financial, or serious privacy harm. | Password verifiers, access/refresh tokens, model/provider keys, signing keys, database credentials, MFA recovery material, raw OTPs, raw private conversation bodies where retained. | Secret manager or protected vault only; never source, logs, analytics, client storage, screenshots, or ordinary exports; rotate and alert on access. |

## Required classification map

| Data set | Default level | Owner | Logging form |
|---|---|---|---|
| Account and contact identifiers | L2; contact secrets may be L3 | Identity | stable account ID, keyed hash, or masked suffix only |
| Device and network risk summaries | L2 | Identity / Trust & Safety | coarse risk code, keyed device hash, truncated/aggregated network signal |
| Learning facts and mastery | L2 | Assessment / Mastery / Review | IDs, rule versions, result codes, timings and aggregates; no unnecessary answer text |
| AI request metadata | L2 | AI Gateway | request/feature/policy/model IDs, token counts, cost band, reason code, latency, outcome; no complete prompt or response body |
| Uploaded files and derived OCR | L2 until published; L0 only after review | Content / Trust & Safety | object ID, version, size, MIME result, scan result, hash; no signed URL or raw content |
| Audit and security records | L2, with secret values L3 | Trust & Safety / platform security | actor ID, scope, action, reason, request/event IDs, before/after fingerprints; no secret values |
| Operations and competition statistics | L1 or L2 if cohort-identifying | Analytics & Evidence | aggregate counts and approved pseudonyms; suppress small cohorts where re-identification is plausible |

## Logging redaction rules

The logging pipeline must reject or transform fields before they reach application logs, traces, metrics labels, worker output, error reports, screenshots, or analytics sinks. The following are prohibited in logs in complete form:

- passwords, password reset material, OTPs, and recovery codes;
- access tokens, refresh tokens, cookies, authorization headers, and session credentials;
- model/provider keys, database credentials, signing keys, webhook secrets, and other production secrets;
- complete phone numbers or equivalent complete contact identifiers;
- complete conversation bodies, prompts, model responses, or uploaded document/image contents;
- signed object-storage URLs, URL query strings containing access signatures, or private download tokens.

Use a request ID, event ID, actor ID, object ID, keyed hash, length, token count, MIME result, version, classification, and reason code instead. A phone display such as `138****1234` is still subject to access control; a complete value must never be logged. For URLs, log the private object ID and operation, not the URL.

## Redaction implementation requirements

1. Redaction happens at structured-log construction, not only in a downstream sink.
2. Unknown fields are denied or classified before logging; free-form exception serialization is prohibited.
3. Secret and PII pattern tests run in CI against representative fixtures with synthetic values only.
4. Trace baggage and metric labels use allowlists; never put tokens, phone numbers, prompts, or object URLs in labels.
5. Support tooling shows a redacted projection and requires a separate audited access path for any approved sensitive view.
6. Retention and deletion jobs cover logs, traces, exports, caches, search indexes, and derived AI/content artifacts, not just the source database.

## Access and incident handling

L2 access requires a business purpose and is audited. L3 access requires an explicit operational reason, stronger authentication, and alerting. Suspected leakage triggers the threat-model response path: stop the source, revoke/rotate credentials or URLs, preserve access evidence, assess scope, notify the responsible security/privacy owner, and verify redaction tests before restoration.
