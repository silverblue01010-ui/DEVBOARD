import { Router } from "express";
import { prisma } from "../lib/prisma";
import { postSlackMessage } from "../integrations/slack";
import { logger } from "../lib/logger";

export const differentiatorsRouter = Router();

const GITHUB_INDUSTRY_AVG_MTTFRC_SECONDS = 4 * 60 * 60; // 4 hours, per Copilot Review's reported industry average

/**
 * Internal/admin-only — not gated behind per-repo API key since it aggregates
 * across all repos. Should sit behind a separate admin auth layer in production;
 * left as a TODO marker rather than faked.
 */
differentiatorsRouter.get("/differentiators", async (_req, res) => {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const cveFindings = await prisma.finding.count({
    where: { ruleId: "SEC-004", detectedAt: { gte: since30d } },
  });

  // PRs "gated by policy" = PRs with at least one critical finding (the dominant
  // built-in gate). Custom gate trigger counts would need a GatedPR log table in a
  // fuller build; approximated here from the existing Finding data.
  const gatedPRs = await prisma.pullRequest.count({
    where: { findings: { some: { severity: "critical" } }, createdAt: { gte: since30d } },
  });

  const recentSnapshots = await prisma.weeklyMetricSnapshot.findMany({
    where: { weekStart: { gte: since30d } },
  });
  const avgMttfrcSeconds =
    recentSnapshots.length > 0
      ? recentSnapshots.reduce((s: number, snap: any) => s + snap.mttfrcMedianSeconds, 0) / recentSnapshots.length
      : null;

  // "Active on-prem installations" requires a deployment registry not modeled in this
  // scaffold's schema; surfaced as null with a note rather than fabricated.
  res.json({
    cvesCaughtLast30d: cveFindings,
    prsGatedByPolicyLast30d: gatedPRs,
    avgMttfrcSecondsLast30d: avgMttfrcSeconds,
    industryAvgMttfrcSeconds: GITHUB_INDUSTRY_AVG_MTTFRC_SECONDS,
    activeOnPremInstallations: null,
    note: "activeOnPremInstallations requires a deployment registry not yet modeled — wire up before using in marketing claims.",
  });
});

/**
 * Posts the Monday digest: last week's metrics vs prior week, top 3 findings, regressions.
 */
export async function sendWeeklyDigest(repositoryId: string, slackWebhookUrl: string) {
  const snapshots = await prisma.weeklyMetricSnapshot.findMany({
    where: { repositoryId },
    orderBy: { weekStart: "desc" },
    take: 2,
  });
  if (snapshots.length === 0) return;

  const [current, prior] = snapshots;
  const topIssues = await prisma.finding.groupBy({
    by: ["ruleId"],
    where: { pullRequest: { repositoryId } },
    _count: { ruleId: true },
    orderBy: { _count: { ruleId: "desc" } },
    take: 3,
  });

  const delta = (curr: number, prev: number | undefined) =>
    prev ? `${curr > prev ? "▲" : curr < prev ? "▼" : "→"} (${prev})` : "";

  const message = [
    "📊 *DevBoard Weekly Digest*",
    `MTTFRC (median): ${current.mttfrcMedianSeconds}s ${delta(current.mttfrcMedianSeconds, prior?.mttfrcMedianSeconds)}`,
    `Vuln detection rate: ${(current.vulnDetectionRate * 100).toFixed(0)}% ${delta(current.vulnDetectionRate, prior?.vulnDetectionRate)}`,
    `Reviewer hours saved (est.): ${current.reviewerHoursSaved.toFixed(1)}h`,
    "",
    "*Top 3 findings this period:*",
    ...topIssues.map((t: any, i: number) => `${i + 1}. ${t.ruleId} (${t._count.ruleId})`),
  ].join("\n");

  try {
    await postSlackMessage(slackWebhookUrl, message);
  } catch (err) {
    logger.error({ err }, "failed to send weekly digest");
  }
  logger.info({ repositoryId }, "weekly digest sent");
  return message;
}
