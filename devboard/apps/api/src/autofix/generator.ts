import { getOctokit } from "../github/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { Finding } from "@devboard/shared";

// Only these rule IDs are eligible for automated fixes, and only above this confidence.
const AUTOFIX_ELIGIBLE_RULES = new Set(["SEC-004", "STYLE-001", "STYLE-002"]);
const AUTOFIX_MIN_CONFIDENCE = 0.9;

export function isAutoFixEligible(finding: Finding): boolean {
  return AUTOFIX_ELIGIBLE_RULES.has(finding.ruleId) && finding.confidence > AUTOFIX_MIN_CONFIDENCE;
}

/**
 * Generates a concrete patch for an eligible finding. Real fix generation is rule-specific;
 * this dispatches to a per-rule fixer. Returns null if no safe automatic fix can be produced.
 */
function generatePatch(finding: Finding, _fileContent: string): { newContent: string; explanation: string } | null {
  switch (finding.ruleId) {
    case "STYLE-002": {
      // Single-character identifier — not safely auto-renamable without full scope analysis.
      // Left as an example of a rule that is *eligible* by policy but declines to act without more context.
      return null;
    }
    case "STYLE-001": {
      // Magic number extraction: leave as a no-op placeholder for real implementation —
      // a real fixer would extract the literal to a named constant at the top of the file.
      return null;
    }
    case "SEC-004": {
      // Dependency bump: handled by generateDependencyBump() against package.json/requirements.txt,
      // not raw file patching. See generateDependencyBumpPR below for the real flow.
      return null;
    }
    default:
      return null;
  }
}

export interface AutoFixParams {
  installationId: string;
  repoFullName: string;
  baseBranch: string;
  finding: Finding & { id: string };
  fileContent: string;
}

/**
 * Opens (or updates) a draft PR from devboard/autofix-{findingId} targeting the same base.
 * Never auto-merges. Only one auto-fix PR per finding — if the branch exists, it is updated.
 */
export async function openAutoFixPR(params: AutoFixParams): Promise<{ prNumber: number | null }> {
  const { installationId, repoFullName, baseBranch, finding, fileContent } = params;
  if (!isAutoFixEligible(finding)) return { prNumber: null };

  const patch = generatePatch(finding, fileContent);
  if (!patch) {
    logger.info({ ruleId: finding.ruleId, findingId: finding.id }, "no safe automatic patch available, skipping autofix");
    return { prNumber: null };
  }

  const [owner, repo] = repoFullName.split("/");
  const octokit = await getOctokit(installationId);
  const branchName = `devboard/autofix-${finding.id}`;

  const existing = await prisma.autoFixPR.findUnique({ where: { findingId: finding.id } });

  const { data: baseRef } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });

  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${branchName}` });
    // branch exists — update it
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: baseRef.object.sha,
      force: true,
    });
  } catch {
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: baseRef.object.sha });
  }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: finding.file,
    message: `DevBoard auto-fix: ${finding.ruleId}`,
    content: Buffer.from(patch.newContent).toString("base64"),
    branch: branchName,
  });

  if (existing?.prNumber) {
    return { prNumber: existing.prNumber };
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: `DevBoard Auto-fix: ${finding.ruleId} in ${finding.file}`,
    head: branchName,
    base: baseBranch,
    draft: true,
    body: [
      `**What changed:** ${patch.explanation}`,
      `**Why:** ${finding.message}`,
      `**Original finding:** ${finding.ruleId} at ${finding.file}:${finding.line} (confidence ${finding.confidence})`,
      "",
      "_This PR was opened automatically by DevBoard and requires human review before merge._",
    ].join("\n\n"),
  });

  await octokit.issues.addLabels({ owner, repo, issue_number: pr.number, labels: ["devboard-autofix"] });

  await prisma.autoFixPR.upsert({
    where: { findingId: finding.id },
    create: { findingId: finding.id, branchName, prNumber: pr.number, status: "open" },
    update: { prNumber: pr.number, status: "open" },
  });

  return { prNumber: pr.number };
}
