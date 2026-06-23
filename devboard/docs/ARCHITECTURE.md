# Architecture Overview

DevBoard is split into two services plus shared packages:

```
devboard/
├── apps/
│   ├── api/          # Express.js — webhooks, REST API, BullMQ worker, all phase logic
│   └── analyzer/     # FastAPI — diff parsing, rule engine, LLM analysis (Python)
├── packages/
│   ├── db/           # Prisma schema (single source of truth for the data model)
│   ├── shared/       # TypeScript types/contracts shared by api + cli
│   └── cli/          # `npx devboard analyze` — calls the same analyzer service
├── infra/
│   ├── docker/       # docker-compose for local dev
│   └── helm/         # Kubernetes Helm chart for on-prem deployment (Phase 3)
└── docs/
```

## Request flow (Phase 1–3, steady state)

1. GitHub sends a `pull_request` webhook → `apps/api/src/webhooks/github.ts`
   verifies the HMAC signature, upserts `Repository`/`PullRequest`, and
   enqueues a BullMQ job. Responds `200` immediately (async processing).
2. `apps/api/src/queue/worker.ts` picks up the job:
   - Fetches the diff via Octokit (cached 1h by head SHA, Phase 6 Risk 3).
   - Calls `POST /analyze` on the FastAPI analyzer.
   - Analyzer (`apps/analyzer/app/main.py`) runs:
     - Phase 1 static rules (`app/rules/`) — security/maintainability/style.
     - Phase 2 LLM analysis (`app/llm/analyzer.py`) — sanitized diff sent to
       Claude, results filtered at confidence ≥ 0.7, always non-blocking.
     - Phase 2 test coverage gap detection (`app/test_coverage.py`).
   - Worker applies rule-lifecycle filtering (shadow/active/suppressed,
     Phase 6 Risk 1), dedupes against prior commits, applies the 20-comment
     noise budget (Phase 6 Risk 4), evaluates `devboard.config.yml` policy
     gates (Phase 3), then posts a single GitHub Review + Check Run + PR
     summary comment.
   - Critical findings trigger Slack/Jira notifications if configured.
3. Every code fetch is recorded in `AuditLog` (Phase 6 Risk 2). A nightly job
   prunes `Finding`/`ReviewComment` rows past each repo's retention window.

## Where each phase's prompt maps to code

| Phase | Primary files |
|---|---|
| 0 — Environment | `infra/docker/docker-compose.yml`, `.env.example`, `packages/db/schema.prisma`, `.github/workflows/ci.yml` |
| 1 — Foundation | `apps/api/src/webhooks/github.ts`, `apps/api/src/github/client.ts`, `apps/analyzer/app/diff_parser.py`, `apps/analyzer/app/rules/*` |
| 2 — Intelligence | `apps/analyzer/app/llm/analyzer.py`, `apps/analyzer/app/cross_file_impact.py`, `apps/analyzer/app/test_coverage.py`, `apps/api/src/feedback/routes.ts`, `packages/cli` |
| 3 — Scale | `apps/api/src/policy/engine.ts`, `apps/api/src/autofix/generator.ts`, `apps/api/src/integrations/*`, `apps/api/src/analytics/routes.ts`, `apps/api/src/plugins/runner.ts`, `infra/helm/` |
| 4 — Guardrails | `docs/scope-guardrails.md` |
| 5 — Metrics | `apps/api/src/metrics/job.ts` |
| 6 — Risk mitigation | `apps/api/src/lib/ruleLifecycle.ts` (Risk 1), `apps/api/src/audit/routes.ts` (Risk 2), `apps/api/src/github/rateLimit.ts` (Risk 3), `apps/api/src/dedup/commentDedup.ts` (Risk 4), `apps/api/src/metrics/differentiators.ts` (Risk 5) |

## What's a real implementation vs. a documented seam

This is a from-scratch scaffold, not a battle-tested production system. A few
things are intentionally left as clearly-marked integration points rather
than faked:

- `autofix/generator.ts`'s `generatePatch()` returns `null` for STYLE-001/002 —
  safely rewriting source without a full AST pass is its own project; the
  eligibility/branch/PR-lifecycle logic around it is real and tested.
- `analytics/routes.ts`'s reviewer-load endpoint notes that human comment
  counts need a live GitHub API call per PR not modeled in this scaffold's DB.
- `metrics/differentiators.ts`'s `activeOnPremInstallations` needs a
  deployment registry this schema doesn't include.
- Encryption for `slackWebhookEncrypted`/`jiraTokenEncrypted` is a clearly
  marked base64 placeholder (`decrypt()` in `worker.ts`) — swap in real
  envelope encryption (KMS/libsodium) before production use.
