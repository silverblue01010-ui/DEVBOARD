# DevBoard

Automated GitHub PR review: rule-based + ML-powered analysis, policy
enforcement, auto-fix PRs, and analytics — built across Phases 0–6 (see
`docs/ARCHITECTURE.md` for how each phase maps to the code).

## Prerequisites

- Node.js 20+
- Python 3.11+
- Docker + Docker Compose (for local Postgres/Redis, or run the full stack)
- A GitHub App (for live webhook testing) — not required to run unit tests
- An Anthropic API key (optional — Phase 2 LLM analysis is skipped without one; Phase 1 rules still run)

## Quickstart (full stack via Docker)

```bash
cp .env.example .env        # fill in GitHub App + Anthropic credentials
npm install                 # also builds packages/shared via postinstall
npm run dev                 # docker compose up --build: postgres, redis, api, worker, analyzer
```

The first `docker compose up --build` runs `prisma generate` *inside the image
build*, which needs outbound network access to `binaries.prisma.sh` — make
sure your machine (not a restricted CI runner) has that. After the first
successful build it's cached.

Health checks:

```bash
curl http://localhost:3000/health   # API
curl http://localhost:8000/health   # Analyzer
```

`docker compose up` now starts the `worker` service too, so the full
webhook → analyze → comment pipeline runs with this one command. To run the
worker on its own (e.g. for local debugging) in addition to/instead of the
Docker one:

```bash
npm run worker --workspace=apps/api
```

## Running without Docker

```bash
# Terminal 1 — Postgres + Redis only
docker compose -f infra/docker/docker-compose.yml up postgres redis

# One-time setup (needs network access to binaries.prisma.sh and a reachable DATABASE_URL)
npm run db:generate
npm run db:migrate --workspace=packages/db

# Terminal 2 — API
cd apps/api && npm run dev

# Terminal 3 — worker
cd apps/api && npm run worker

# Terminal 4 — analyzer
cd apps/analyzer && pip install -r requirements.txt --break-system-packages
uvicorn app.main:app --reload
```

## Local CLI (no webhook needed)

```bash
cd packages/cli && npm install && npm run build
node dist/index.js analyze --diff /path/to/some.diff
# or, with a GitHub PAT:
GITHUB_TOKEN=ghp_xxx node dist/index.js analyze --repo acme/widgets --pr-number 42
```

## Troubleshooting

**`prisma generate` fails with a 403/checksum error fetching from `binaries.prisma.sh`**
Your network (corporate proxy, restrictive CI runner, offline sandbox) is
blocking Prisma's engine CDN. Fix the network access, or set
`PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` only if you're certain you have a
trusted cached copy already — don't use that flag to silently skip a real
download failure.

**`tsc`/`jest` fail with `Cannot find module '@devboard/shared'`**
Run `npm install` from the repo root once (its `postinstall` hook builds
`packages/shared` automatically). If you only ran `npm install` inside a
single `apps/*` folder, workspace packages won't be linked correctly — always
install from the root.

**`docker compose up` fails the `api` or `worker` image build**
Make sure you're running `docker compose -f infra/docker/docker-compose.yml up`
from a checkout where `apps/api/Dockerfile` builds with the **repo root** as
context (already configured) — if you've modified the Dockerfile/compose
paths, COPY instructions can't reach outside their build context.

**Webhook never triggers an analysis**
Check, in order: (1) the GitHub App webhook URL matches your public
`/webhook/github` endpoint (use `ngrok http 3000` for local testing), (2)
`GITHUB_WEBHOOK_SECRET` in `.env` matches the one configured on the GitHub
App, (3) the `worker` process/container is actually running — the API only
enqueues jobs, it doesn't process them.

**LLM findings are always empty**
Expected if `ANTHROPIC_API_KEY` isn't set — Phase 2 LLM analysis is skipped
gracefully and Phase 1 rule-based findings still post normally. Check
`apps/analyzer` logs for `"ANTHROPIC_API_KEY not set; skipping LLM analysis"`.

## Tests

```bash
# TypeScript (apps/api)
npm run test --workspace=apps/api

# Python (apps/analyzer)
cd apps/analyzer && pytest -v
```
const api_key = "sk_live_abc123def456789";
console.log("debug", api_key);
## Policy-as-code

Drop a `devboard.config.yml` in your repo root — see
`examples/devboard.config.yml` for the full schema (merge gates, Slack/Jira
notifications, plugins).

## On-prem deployment

See `infra/helm/devboard` and `docs/onprem-migration.md`.

## Project structure

See `docs/ARCHITECTURE.md`.

## Scope

See `docs/scope-guardrails.md` for what DevBoard is and isn't.


Webhook PR test
