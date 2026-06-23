import { Worker, Job } from "bullmq";
import { redis } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { ANALYSIS_QUEUE_NAME, ANALYZE_PR_JOB_NAME, analysisQueue } from "./queue";
import { getPRDiff, postReviewComment, postCheckRun, postOrUpdateTopLevelComment } from "../github/client";
import { isThrottled, msUntilReset, withBackoff } from "../github/rateLimit";
import { formatFindingAsComment, reviewEventForFindings, checkRunSummary, prSummaryComment } from "./commentFormatter";
import { dedupeAgainstPriorCommits, applyNoiseBudget, noiseBudgetSummary } from "../dedup/commentDedup";
import { parseConfig, evaluateGates } from "../policy/engine";
import { notifySlack } from "../integrations/slack";
import { createJiraIssue } from "../integrations/jira";
import { logCodeAccess } from "../audit/routes";
import { getRuleState } from "../lib/ruleLifecycle";
import axios from "axios";
import type { AnalysisJobPayload, AnalyzeResponse, Finding } from "@devboard/shared";
import { ErrorCodes } from "@devboard/shared";

const ANALYZER_URL = process.env.ANALYZER_URL || "http://localhost:8000";
const SLA_MS = 60_000;

async function callAnalyzer(payload: { repoFullName: string; prNumber: number; headSha: string; diff: string }): Promise<AnalyzeResponse> {
  const { data } = await axios.post<AnalyzeResponse>(`${ANALYZER_URL}/analyze`, payload, { timeout: 35_000 });
  return data;
}

/**
 * Filters out findings from rules currently in "shadow" or "suppressed" state.
 * Shadow-mode findings are logged to DB but never posted as comments (Phase 6, Risk 1).
 */
async function filterByRuleLifecycle(findings: Finding[]): Promise<{ postable: Finding[]; shadowed: Finding[] }> {
  const postable: Finding[] = [];
  const shadowed: Finding[] = [];
  for (const f of findings) {
    // Only static rule findings go through lifecycle gating; LLM/plugin findings are
    // already non-blocking by construction.
    if (f.source !== "RULE") {
      postable.push(f);
      continue;
    }
    const state = await getRuleState(f.ruleId);
    if (state.state === "suppressed") continue;
    if (state.state === "shadow") {
      shadowed.push(f);
      continue;
    }
    postable.push(f);
  }
  return { postable, shadowed };
}

async function processJob(job: Job<AnalysisJobPayload>) {
  const start = Date.now();
  const { repoFullName, prNumber, headSha, installationId } = job.data;

  if (await isThrottled(installationId)) {
    const delay = await msUntilReset(installationId);
    logger.warn({ repoFullName, prNumber, delay }, "installation throttled, requeueing");
    await analysisQueue.add(ANALYZE_PR_JOB_NAME, job.data, { delay });
    return;
  }

  const repo = await prisma.repository.findUnique({ where: { fullName: repoFullName } });
  if (!repo) throw new Error(`unknown repository ${repoFullName}`);

  const pr = await prisma.pullRequest.upsert({
    where: { repositoryId_number: { repositoryId: repo.id, number: prNumber } },
    update: { headSha },
    create: { repositoryId: repo.id, number: prNumber, headSha },
  });

  await postCheckRun(installationId, repoFullName, headSha, "in_progress", undefined, {
    title: "DevBoard analysis running",
    summary: "Fetching diff and running rule + ML analysis…",
  });

  const diff = await withBackoff(() => getPRDiff(installationId, repoFullName, prNumber, headSha));
  await logCodeAccess({
    repositoryId: repo.id,
    prNumber,
    callerService: "api",
    linesTransmitted: diff.split("\n").length,
  });

  const analysis = await callAnalyzer({ repoFullName, prNumber, headSha, diff });

  const allFindings: Finding[] = [
    ...analysis.ruleFindings,
    ...analysis.llmFindings,
    ...analysis.testCoverageGaps,
  ];

  const { postable, shadowed } = await filterByRuleLifecycle(allFindings);

  // Persist everything (including shadowed findings, for later precision evaluation).
  for (const f of [...postable, ...shadowed]) {
    await prisma.finding.create({
      data: {
        pullRequestId: pr.id,
        ruleId: f.ruleId,
        source: f.source,
        severity: f.severity,
        file: f.file,
        line: f.line,
        message: f.message,
        suggestion: f.suggestion,
        confidence: f.confidence,
        headSha,
      },
    });
  }

  const deduped = await dedupeAgainstPriorCommits(pr.id, postable);
  const fresh = deduped.filter((f) => !f.isRepeatOfPriorCommit);
  const { toPost, truncatedCount } = applyNoiseBudget(fresh);

  const comments = toPost.map((f) => formatFindingAsComment({ ...f, headSha }));
  const event = reviewEventForFindings(toPost);

  // --- Policy gates (Phase 3) ---
  const teamConfig = await prisma.teamConfig.findUnique({ where: { repositoryId: repo.id } });
  let gateBlocked = false;
  let gateFailureMessage: string | undefined;
  if (teamConfig) {
    const config = parseConfig(teamConfig.rawYaml);
    const changedFiles = Array.from(new Set(toPost.map((f) => f.file)));
    const results = evaluateGates(config, { findings: toPost, changedFiles, isFeatureBranch: true });
    const blockingGate = results.find((r) => r.triggered && r.gate.action === "block");
    if (blockingGate) {
      gateBlocked = true;
      gateFailureMessage = blockingGate.gate.description || blockingGate.gate.id;
    }
  }

  const reviewEvent = gateBlocked ? "REQUEST_CHANGES" : event;
  await withBackoff(() => postReviewComment(installationId, repoFullName, prNumber, headSha, comments, reviewEvent));

  if (!pr.firstCommentPostedAt && comments.length > 0) {
    await prisma.pullRequest.update({ where: { id: pr.id }, data: { firstCommentPostedAt: new Date() } });
  }

  const noiseSummary = noiseBudgetSummary(fresh.length, truncatedCount);
  if (noiseSummary) {
    await postOrUpdateTopLevelComment(installationId, repoFullName, prNumber, undefined, noiseSummary);
  }

  await postOrUpdateTopLevelComment(
    installationId,
    repoFullName,
    prNumber,
    undefined,
    prSummaryComment({
      summary: analysis.summary,
      riskLevel: analysis.riskLevel,
      impactedModules: analysis.impactedModules,
      suggestedReviewers: analysis.suggestedReviewers,
      criticalCount: toPost.filter((f) => f.severity === "critical").length,
      warningCount: toPost.filter((f) => f.severity === "warning").length,
      llmSuggestionCount: analysis.llmFindings.length,
    })
  );

  const hasCritical = toPost.some((f) => f.severity === "critical");
  await postCheckRun(
    installationId,
    repoFullName,
    headSha,
    "completed",
    hasCritical || gateBlocked ? "failure" : "success",
    {
      title: gateBlocked ? `Blocked by policy gate: ${gateFailureMessage}` : "DevBoard analysis complete",
      summary: checkRunSummary(toPost, new Set(toPost.map((f) => f.file)).size),
    }
  );

  // --- Notifications (Phase 3) ---
  const criticalFindings = toPost.filter((f) => f.severity === "critical");
  if (teamConfig?.slackWebhookEncrypted && criticalFindings.length > 0) {
    const webhookUrl = decrypt(teamConfig.slackWebhookEncrypted);
    const prUrl = `https://github.com/${repoFullName}/pull/${prNumber}`;
    for (const f of criticalFindings) {
      await notifySlack({ webhookUrl, finding: f, prUrl });
    }
  }
  if (teamConfig?.jiraTokenEncrypted) {
    const config = parseConfig(teamConfig.rawYaml);
    const jiraCfg = config.integrations?.jira;
    if (jiraCfg?.base_url && jiraCfg?.project_key) {
      for (const f of criticalFindings.filter((f) => f.ruleId.startsWith("SEC"))) {
        await createJiraIssue({
          baseUrl: jiraCfg.base_url,
          apiToken: decrypt(teamConfig.jiraTokenEncrypted),
          projectKey: jiraCfg.project_key,
          finding: f,
          prUrl: `https://github.com/${repoFullName}/pull/${prNumber}`,
        });
      }
    }
  }

  const durationMs = Date.now() - start;
  logger.info({ repoFullName, prNumber, durationMs, withinSla: durationMs <= SLA_MS }, "analysis job complete");
  if (durationMs > SLA_MS) {
    logger.warn({ repoFullName, prNumber, durationMs }, "exceeded 60s SLA for first comment");
  }
}

// Placeholder symmetric decrypt — a real build uses libsodium/KMS-backed envelope
// encryption; kept as a clearly-marked seam rather than a fake implementation.
function decrypt(ciphertext: string): string {
  return Buffer.from(ciphertext, "base64").toString("utf8");
}

export const analysisWorker = new Worker<AnalysisJobPayload>(
  ANALYSIS_QUEUE_NAME,
  async (job) => {
    try {
      await processJob(job);
    } catch (err) {
      logger.error({ err, jobId: job.id }, "analysis job failed");
      if (job.attemptsMade >= (job.opts.attempts || 3) - 1) {
        const { repoFullName, headSha, installationId } = job.data;
        await postCheckRun(installationId, repoFullName, headSha, "completed", "neutral", {
          title: "DevBoard analysis failed",
          summary: `Failed after ${job.opts.attempts} attempts: ${String(err)}. ${ErrorCodes.JOB_FAILED_FINAL}`,
        }).catch(() => {});
      }
      throw err; // let BullMQ's retry/backoff handle it
    }
  },
  { connection: redis, concurrency: 5 }
);
