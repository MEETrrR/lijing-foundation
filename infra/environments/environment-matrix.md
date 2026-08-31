# Environment Matrix

## Isolation rule

`local`, `staging`, and `production` are separate security domains. Each environment has its own identity provider configuration, database, Redis namespace/cluster, object storage bucket and signing keys, message bus credentials, AI provider project/keys, budget, logs, alerts, and operator access. Credential reuse or data-store reuse across rows is prohibited.

Production data must never be copied to local or staging. Test fixtures are synthetic or irreversibly de-identified. A deployment must fail closed if an environment variable points at a different environment's resource identity.

## Matrix

| Area | local | staging | production |
|---|---|---|---|
| Purpose | Developer feedback and contract/unit tests | Integration, security, load, moderation, and release-candidate validation | Real users and controlled operations |
| Credentials | Personal/dev credentials or local adapters; stored outside source | Dedicated staging service accounts and secret namespace | Dedicated production service accounts, vault namespace, and break-glass path |
| Identity | Local/sandbox issuer with synthetic accounts | Staging issuer and test-only accounts | Production issuer, real account controls, MFA for admins |
| PostgreSQL | Local isolated database, disposable seed data | Dedicated staging cluster/database, reset only through approved fixtures | Dedicated production cluster/database with backups, migration gates, and restricted network access |
| Redis | Local instance/namespace; cache and limit state may be reset | Dedicated staging instance/namespace | Dedicated production cluster/namespace; never the only business fact |
| Object storage/CDN | Local emulator or `lijing-local` private bucket; no public default | `lijing-staging` private bucket and staging CDN distribution with staging signing keys | `lijing-production` private bucket and production CDN distribution with production signing keys |
| Message bus | Local adapter or isolated local topic set | Dedicated staging bus/project and dead-letter queues | Dedicated production bus/project, retention, replay, and dead-letter controls |
| AI provider | Stub/sandbox adapter by default; external calls disabled unless explicitly approved | Separate provider project/keys with synthetic prompts and a bounded staging budget | Separate provider project/keys, approved models, independent daily/monthly budgets, alerts, and kill switches |
| AI budget identity | `budget.lijing.local`; default external spend ceiling is zero | `budget.lijing.staging`; low bounded test ceiling with test-only alerts | `budget.lijing.production`; approved operating ceiling with independent alerting and automatic stop thresholds |
| Logs/traces | Local files or developer sink with redaction tests | Staging sink with retention and DLP checks | Restricted production sink, alerting, retention policy, and audited access |
| Admin access | Local developer roles with synthetic data | Named test operators, MFA where supported | Least-privilege roles, MFA, approval workflow, and break-glass audit |
| Reset/rollback | Freely reset synthetic state | Rebuild from approved fixtures; preserve evidence for release tests | Forward-compatible migration, backup restore, projection rebuild, and versioned config rollback |

## Required configuration identities

Environment configuration should use explicit names such as:

```text
APP_ENV=local|staging|production
DATABASE_RESOURCE_ID=lijing-<environment>-primary
REDIS_RESOURCE_ID=lijing-<environment>-cache
OBJECT_STORAGE_RESOURCE_ID=lijing-<environment>-private
MESSAGE_BUS_RESOURCE_ID=lijing-<environment>-events
AI_PROVIDER_PROJECT_ID=lijing-<environment>-ai
AI_BUDGET_ID=budget.lijing.<environment>
SECRET_NAMESPACE=lijing/<environment>
```

These are resource labels, not credentials. Actual values for passwords, tokens, keys, connection strings, signing material, and provider secrets come from the environment's secret manager or local developer injection and never from this repository.

## Promotion gates

1. A staging artifact must be traceable to a source revision, dependency lock, contract version, policy version, and migration set.
2. Production promotion must verify all resource IDs and secret namespaces have the `production` identity and that no staging/local credential is mounted.
3. AI features remain disabled or use a low-cost fallback until production quota, budget, provider route, output validation, and kill-switch checks pass.
4. Data exports from production are approved, minimized, aggregated or irreversibly de-identified, and recorded in the audit trail.
5. Rollback restores the previous application/configuration version without rewriting authoritative learning, reward, audit, or usage facts.
