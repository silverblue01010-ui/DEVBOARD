import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRepoApiKey } from "../lib/auth";
import { logger } from "../lib/logger";

export const metricsRouter = Router();

function startOfWeekUTC(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() - day);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Computes all five Phase 5 success metrics for one repo over the prior week and
 * inserts an immutable WeeklyMetricSnapshot row. Run every Sunday 00:00 UTC via cron.
 */
export async function computeWeeklyMetrics(repositoryId: string, weekStart: Date) {
  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const prs = await prisma.pullRequest.findMany({
    where: { repositoryId, createdAt: { gte: weekStart, lt: weekEnd } },
    include: { findings: { include: { reactions: true } }, reviewComments: true },
  });

  // 1. Mean Time to First Review Comment
  const ttfrc = prs
    .filter((pr: any) => pr.webhookReceivedAt && pr.firstCommentPostedAt)
    .map((pr: any) => (pr.firstCommentPostedAt!.getTime() - pr.webhookReceivedAt!.getTime()) / 1000)
    .sort((a: number, b: number) => a - b);
  const mttfrcMedianSeconds = Math.round(percentile(ttfrc, 50));
  const mttfrcP95Seconds = Math.round(percentile(ttfrc, 95));

  // 2. Pre-Merge Vulnerability Detection Rate (proxy: % of merged PRs with >=1 SEC finding pre-merge)
  const mergedPrs = prs.filter((pr: any) => pr.mergedAt);
  const mergedWithSecFinding = mergedPrs.filter((pr: any) =>
    pr.findings.some((f: any) => f.ruleId.startsWith("SEC") && f.detectedAt < pr.mergedAt!)
  );
  const vulnDetectionRate = mergedPrs.length > 0 ? mergedWithSecFinding.length / mergedPrs.length : 0;

  // 3. Reviewer Hours Saved (estimate, clearly labeled as such)
  let usefulReactionCount = 0;
  for (const pr of prs) {
    for (const f of pr.findings) {
      usefulReactionCount += f.reactions.filter((r: any) => r.reaction === "useful").length;
    }
  }
  const estimatedMinutes = usefulReactionCount * 20 + prs.length * 5; // 20 min/useful reaction, 5 min floor/PR
  const reviewerHoursSaved = estimatedMinutes / 60;

  // 5. Developer Satisfaction (holistic sentiment, separate from per-rule precision)
  let useful = 0;
  let irrelevant = 0;
  for (const pr of prs) {
    for (const f of pr.findings) {
      useful += f.reactions.filter((r: any) => r.reaction === "useful").length;
      irrelevant += f.reactions.filter((r: any) => r.reaction === "irrelevant").length;
    }
  }
  const satisfactionScore = useful + irrelevant > 0 ? useful / (useful + irrelevant) : null;

  const snapshot = await prisma.weeklyMetricSnapshot.upsert({
    where: { repositoryId_weekStart: { repositoryId, weekStart } },
    update: {}, // immutable once written — Phase 5 constraint; upsert only creates, never overwrites
    create: {
      repositoryId,
      weekStart,
      mttfrcMedianSeconds,
      mttfrcP95Seconds,
      vulnDetectionRate,
      reviewerHoursSaved,
      satisfactionScore: satisfactionScore ?? undefined,
    },
  });

  return snapshot;
}

export async function runWeeklyMetricsJob() {
  const weekStart = startOfWeekUTC(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  const repos = await prisma.repository.findMany();
  for (const repo of repos) {
    try {
      const snapshot = await computeWeeklyMetrics(repo.id, weekStart);
      await flagRegressions(repo.id, snapshot.weekStart);
    } catch (err) {
      logger.error({ err, repo: repo.fullName }, "weekly metrics computation failed");
    }
  }
}

async function flagRegressions(repositoryId: string, weekStart: Date) {
  const priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [current, prior] = await Promise.all([
    prisma.weeklyMetricSnapshot.findUnique({ where: { repositoryId_weekStart: { repositoryId, weekStart } } }),
    prisma.weeklyMetricSnapshot.findUnique({ where: { repositoryId_weekStart: { repositoryId, weekStart: priorWeekStart } } }),
  ]);
  if (!current || !prior) return;

  if (prior.mttfrcMedianSeconds > 0) {
    const pctChange = (current.mttfrcMedianSeconds - prior.mttfrcMedianSeconds) / prior.mttfrcMedianSeconds;
    if (pctChange > 0.2) {
      logger.warn({ repositoryId, pctChange }, "MTTFRC regression > 20% week over week");
    }
  }
}

metricsRouter.use(requireRepoApiKey);

metricsRouter.get("/summary", async (req, res) => {
  const repo = (req as any).repo;
  const snapshots = await prisma.weeklyMetricSnapshot.findMany({
    where: { repositoryId: repo.id },
    orderBy: { weekStart: "desc" },
    take: 5,
  });
  res.json({ latest: snapshots[0] || null, trend: snapshots.reverse() });
});

metricsRouter.get("/history", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);
  const snapshots = await prisma.weeklyMetricSnapshot.findMany({
    where: { repositoryId: repo.id, weekStart: { gte: since } },
    orderBy: { weekStart: "asc" },
  });
  res.json({ snapshots });
});
