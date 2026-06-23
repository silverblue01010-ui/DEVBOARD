import { prisma } from "../lib/prisma";
import { Finding, Severity } from "@devboard/shared";

const NOISE_BUDGET = 20;
const severityRank: Record<Severity, number> = { critical: 0, warning: 1, suggestion: 2 };

export interface DedupedFinding extends Finding {
  isRepeatOfPriorCommit: boolean;
}

/**
 * Cross-references new findings against findings already posted on a prior commit
 * of the same PR (same ruleId + file + line). Repeats are flagged rather than
 * re-posted as a brand-new comment (Phase 6, Risk 4).
 */
export async function dedupeAgainstPriorCommits(
  pullRequestId: string,
  findings: Finding[]
): Promise<DedupedFinding[]> {
  const priorFindings = await prisma.finding.findMany({
    where: { pullRequestId },
    select: { ruleId: true, file: true, line: true },
  });
  const priorSet = new Set(priorFindings.map((f: any) => `${f.ruleId}:${f.file}:${f.line}`));

  return findings.map((f: Finding) => ({
    ...f,
    isRepeatOfPriorCommit: priorSet.has(`${f.ruleId}:${f.file}:${f.line}`),
  }));
}

/**
 * Caps total posted comments per PR at NOISE_BUDGET, keeping the most severe first.
 * Returns the comments to actually post plus a count of how many were truncated.
 */
export function applyNoiseBudget(findings: Finding[]): { toPost: Finding[]; truncatedCount: number } {
  const sorted = [...findings].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const toPost = sorted.slice(0, NOISE_BUDGET);
  const truncatedCount = Math.max(sorted.length - NOISE_BUDGET, 0);
  return { toPost, truncatedCount };
}

export function noiseBudgetSummary(totalFindings: number, truncatedCount: number): string | null {
  if (truncatedCount === 0) return null;
  return `DevBoard found ${totalFindings} total issues. Showing top ${NOISE_BUDGET} by severity. Run \`npx devboard analyze\` locally to see all.`;
}

/**
 * Findings present on the prior commit but absent from the current diff are resolved.
 * Their GitHub comment should be marked outdated (minimized, or annotated with a
 * "Resolved" marker if minimizeComment isn't available).
 */
export async function findResolvedFindings(pullRequestId: string, currentFindingKeys: Set<string>) {
  const prior = await prisma.finding.findMany({
    where: { pullRequestId },
    include: { reviewComment: true },
  });
  return prior.filter(
    (f: any) => !currentFindingKeys.has(`${f.ruleId}:${f.file}:${f.line}`) && f.reviewComment && !f.reviewComment.resolvedAt
  );
}
