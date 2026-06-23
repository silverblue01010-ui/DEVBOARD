import { Queue } from "bullmq";
import { redis } from "../lib/redis";
import type { AnalysisJobPayload } from "@devboard/shared";

export const ANALYSIS_QUEUE_NAME = "analysis";
export const ANALYZE_PR_JOB_NAME = "analyze-pr" as const;

export const analysisQueue = new Queue<AnalysisJobPayload, void, typeof ANALYZE_PR_JOB_NAME>(ANALYSIS_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 500,
    removeOnFail: 1000,
  },
});

export async function enqueueAnalysisJob(payload: AnalysisJobPayload) {
  return analysisQueue.add(ANALYZE_PR_JOB_NAME, payload, {
    jobId: `${payload.repoFullName}:${payload.prNumber}:${payload.headSha}`,
  });
}
