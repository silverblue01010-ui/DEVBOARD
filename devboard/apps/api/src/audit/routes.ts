import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireRepoApiKey } from "../lib/auth";
import { logger } from "../lib/logger";

export const auditRouter = Router();

export async function logCodeAccess(params: {
  repositoryId: string;
  prNumber: number;
  callerService: string;
  linesTransmitted: number;
}) {
  await prisma.auditLog.create({ data: params });
}

auditRouter.use(requireRepoApiKey);

auditRouter.get("/code-access", async (req, res) => {
  const repo = (req as any).repo;
  const since = req.query.since ? new Date(req.query.since as string) : new Date(0);

  const logs = await prisma.auditLog.findMany({
    where: { repositoryId: repo.id, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
    take: 1000,
  });

  res.json({ logs });
});

/**
 * Scheduled job (wired via node-cron in index.ts): deletes Finding and ReviewComment
 * records older than each repo's configurable retention period (default 90 days).
 * Also prunes audit logs older than 90 days regardless of repo config.
 */
export async function enforceRetentionPolicy() {
  const repos = await prisma.repository.findMany();
  for (const repo of repos) {
    const cutoff = new Date(Date.now() - repo.retentionDays * 24 * 60 * 60 * 1000);

    const staleReviewComments = await prisma.reviewComment.deleteMany({
      where: { pullRequest: { repositoryId: repo.id }, postedAt: { lt: cutoff } },
    });
    const staleFindings = await prisma.finding.deleteMany({
      where: { pullRequest: { repositoryId: repo.id }, detectedAt: { lt: cutoff } },
    });

    if (staleFindings.count || staleReviewComments.count) {
      logger.info(
        { repo: repo.fullName, deletedFindings: staleFindings.count, deletedComments: staleReviewComments.count },
        "enforced retention policy"
      );
    }
  }

  const auditCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await prisma.auditLog.deleteMany({ where: { timestamp: { lt: auditCutoff } } });
}
