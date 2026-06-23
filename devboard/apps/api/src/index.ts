import express from "express";
import cron from "node-cron";
import { logger } from "./lib/logger";
import { webhookRouter } from "./webhooks/github";
import { feedbackRouter } from "./feedback/routes";
import { analyticsRouter } from "./analytics/routes";
import { auditRouter, enforceRetentionPolicy } from "./audit/routes";
import { metricsRouter, runWeeklyMetricsJob } from "./metrics/job";
import { differentiatorsRouter } from "./metrics/differentiators";
import { rulesRouter, evaluateShadowRules, dailyPrecisionReport } from "./lib/ruleLifecycle";

const app = express();
const PORT = process.env.API_PORT || 3000;

// Capture the raw body for GitHub webhook signature verification (must run on the
// exact bytes received, before any JSON re-serialization).
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Phase 1
app.use("/webhook", webhookRouter);

// Phase 2
app.use("/api", feedbackRouter);

// Phase 3
app.use("/api/analytics", analyticsRouter);

// Phase 5
app.use("/api/metrics", metricsRouter);

// Phase 6
app.use("/api/audit", auditRouter);
app.use("/api/admin", differentiatorsRouter);
app.use("/api/rules", rulesRouter);

app.listen(PORT, () => {
  logger.info(`DevBoard API listening on :${PORT}`);
});

// --- Scheduled jobs ---
// Phase 5: weekly metrics, every Sunday 00:00 UTC
cron.schedule("0 0 * * 0", () => {
  runWeeklyMetricsJob().catch((err) => logger.error({ err }, "weekly metrics job failed"));
});

// Phase 6, Risk 1: shadow-mode rule evaluation + daily precision report
cron.schedule("0 6 * * *", () => {
  evaluateShadowRules().catch((err) => logger.error({ err }, "shadow rule evaluation failed"));
  dailyPrecisionReport().catch((err) => logger.error({ err }, "daily precision report failed"));
});

// Phase 6, Risk 2: nightly retention enforcement
cron.schedule("0 3 * * *", () => {
  enforceRetentionPolicy().catch((err) => logger.error({ err }, "retention policy enforcement failed"));
});

// The BullMQ worker (apps/api/src/queue/worker.ts) runs as a separate process —
// started via `npm run worker` — so a stalled worker never takes down the API.
