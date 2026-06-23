import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRepoApiKey } from "../lib/auth";

export const analyticsRouter = Router();
analyticsRouter.use(requireRepoApiKey);

const REVIEWER_MINUTES_PER_PR = 20;

analyticsRouter.get("/overview", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);

  const prs = await prisma.pullRequest.findMany({
    where: { repositoryId: repo.id, createdAt: { gte: since } },
    include: { findings: true, reviewComments: true },
  });

  const totalPRsReviewed = prs.length;
  const criticalFindingsFound = prs.reduce(
    (sum: number, pr: any) => sum + pr.findings.filter((f: any) => f.severity === "critical").length,
    0
  );
  const criticalFindingsBlocked = criticalFindingsFound; // SEC rules are always blocking per Phase 1

  const withTiming = prs.filter((pr: any) => pr.webhookReceivedAt && pr.firstCommentPostedAt);
  const avgTimeToFirstComment =
    withTiming.length > 0
      ? withTiming.reduce(
          (sum: number, pr: any) => sum + (pr.firstCommentPostedAt!.getTime() - pr.webhookReceivedAt!.getTime()) / 1000,
          0
        ) / withTiming.length
      : null;

  res.json({
    totalPRsReviewed,
    criticalFindingsFound,
    criticalFindingsBlocked,
    avgTimeToFirstComment,
    reviewerHoursSaved: (totalPRsReviewed * REVIEWER_MINUTES_PER_PR) / 60,
  });
});

analyticsRouter.get("/findings-trend", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);

  const findings = await prisma.finding.findMany({
    where: { pullRequest: { repositoryId: repo.id }, detectedAt: { gte: since } },
  });

  const byWeek = new Map<string, Record<string, number>>();
  for (const f of findings) {
    const weekStart = startOfIsoWeek(f.detectedAt).toISOString().slice(0, 10);
    const bucket = byWeek.get(weekStart) || { critical: 0, warning: 0, suggestion: 0 };
    bucket[f.severity] += 1;
    byWeek.set(weekStart, bucket);
  }

  res.json({
    trend: Array.from(byWeek.entries()).map(([week, counts]) => ({ week, ...counts })),
  });
});

analyticsRouter.get("/top-issues", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);
  const limit = Number(req.query.limit) || 10;

  const findings = await prisma.finding.findMany({
    where: { pullRequest: { repositoryId: repo.id }, detectedAt: { gte: since } },
    include: { pullRequest: true },
  });

  const byRule = new Map<string, { count: number; examplePRs: Set<number> }>();
  for (const f of findings) {
    const entry = byRule.get(f.ruleId) || { count: 0, examplePRs: new Set<number>() };
    entry.count += 1;
    entry.examplePRs.add(f.pullRequest.number);
    byRule.set(f.ruleId, entry);
  }

  const sorted = Array.from(byRule.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([ruleId, { count, examplePRs }]) => ({
      ruleId,
      count,
      examplePRs: Array.from(examplePRs).slice(0, 5),
    }));

  res.json({ topIssues: sorted });
});

analyticsRouter.get("/reviewer-load", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);

  const prs = await prisma.pullRequest.findMany({
    where: { repositoryId: repo.id, createdAt: { gte: since } },
    include: { reviewComments: true },
  });

  const devboardComments = prs.reduce((sum: number, pr: any) => sum + pr.reviewComments.length, 0);

  // Human comment counts require a GitHub API call per PR in a full build (not stored
  // locally); left as a documented integration point rather than fabricated data.
  res.json({
    prsReviewed: prs.length,
    devboardCommentShare: devboardComments,
    note: "Human comment counts require a live GitHub API lookup per PR — not computed from local data in this scaffold.",
  });
});

function startOfIsoWeek(date: Date): Date {
  const d = new Date(date);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
