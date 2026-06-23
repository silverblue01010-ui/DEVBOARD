# Migrating from Cloud-Hosted DevBoard to On-Prem

This guide covers moving a team from the hosted DevBoard service to an
in-cluster (on-prem) deployment using the Helm chart in `infra/helm/devboard`.

## 1. Export your data (if you want to keep history)

DevBoard's cloud data — `Finding`, `ReviewComment`, `WeeklyMetricSnapshot`,
`AuditLog` — lives in Postgres. Take a `pg_dump` of your cloud database and
plan to `pg_restore` it into the new cluster's Postgres instance (or your
managed Postgres if `postgres.enabled: false`).

## 2. Provision the cluster prerequisites

- A Kubernetes cluster (1.27+) with an ingress controller and cert-manager (or
  equivalent TLS termination).
- A `devboard-secrets` Secret (or your own name, set via
  `secrets.existingSecretName`) containing: `GITHUB_APP_ID`,
  `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY` (omit if
  you don't want any LLM calls at all), `API_KEY_SALT`, and optionally
  `SLACK_WEBHOOK_URL` / `JIRA_API_TOKEN` defaults.
- If you don't want to run Postgres/Redis in-cluster, provision managed
  instances and create the `*ConnectionSecretName` secrets referenced in
  `values.yaml` instead, then set `postgres.enabled: false` /
  `redis.enabled: false`.

## 3. Decide your LLM posture

Set `mode: onprem` in `values.yaml`. In this mode:

- All outbound telemetry is disabled.
- LLM calls (Phase 2 analysis) are skipped entirely unless
  `llm.selfHostedEndpoint` points at a self-hosted model server compatible
  with the Anthropic Messages API shape used in `apps/analyzer/app/llm/analyzer.py`.
- Rule-based analysis (Phase 1) always runs regardless of LLM availability.

## 4. Install

```bash
helm upgrade --install devboard infra/helm/devboard \
  --namespace devboard --create-namespace \
  -f my-values.yaml
```

## 5. Point your GitHub App at the new ingress host

Update the GitHub App's webhook URL to
`https://<ingress.host>/webhook/github`. Re-deliver a recent webhook from the
GitHub App settings page to confirm the new cluster receives and processes it
(check `kubectl logs` on the `devboard-worker` pods).

## 6. Decommission the cloud instance

Once a few PRs have been successfully reviewed against the new cluster,
disable the GitHub App installation pointing at the old cloud webhook URL.

## Rollback

Keep the cloud deployment running in parallel for at least one sprint. Since
GitHub Apps can only point webhooks at one URL at a time, rollback means
repointing the webhook URL back to the cloud instance — no data migration is
required to roll back, only the URL change.
