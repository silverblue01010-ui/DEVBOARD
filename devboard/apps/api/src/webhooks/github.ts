import { Router, Request, Response } from "express";
import crypto from "crypto";
import { enqueueAnalysisJob } from "../queue/queue";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { ErrorCodes } from "@devboard/shared";

export const webhookRouter = Router();

const RELEVANT_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

/**
 * Verifies the X-Hub-Signature-256 header against GITHUB_WEBHOOK_SECRET.
 * Unsigned or mismatched payloads are always rejected — never skip this (Phase 1 constraint).
 */
function verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false; // length mismatch etc.
  }
}

webhookRouter.post("/github", async (req: Request, res: Response) => {
  const signature = req.header("x-hub-signature-256");
  // req.rawBody is attached by the raw-body middleware in index.ts, required because
  // signature verification must run against the exact bytes received, not re-serialized JSON.
  const rawBody: Buffer = (req as any).rawBody;

  if (!verifySignature(rawBody, signature)) {
    logger.warn({ code: ErrorCodes.WEBHOOK_SIGNATURE_INVALID }, "rejected webhook with invalid signature");
    return res.status(401).json({ error: "invalid signature" });
  }

  const event = req.header("x-github-event");
  if (event !== "pull_request") {
    return res.status(200).json({ ignored: true, event });
  }

  const payload = req.body;
  if (!RELEVANT_ACTIONS.has(payload?.action)) {
    return res.status(200).json({ ignored: true, action: payload?.action });
  }

  try {
    const repoFullName: string = payload.repository.full_name;
    const prNumber: number = payload.pull_request.number;
    const headSha: string = payload.pull_request.head.sha;
    const installationId: string = String(payload.installation.id);
    const isFeatureBranch = payload.pull_request.base.ref !== payload.pull_request.head.ref;

    const repo = await prisma.repository.upsert({
      where: { fullName: repoFullName },
      update: { installationId },
      create: { fullName: repoFullName, installationId },
    });

    await prisma.pullRequest.upsert({
      where: { repositoryId_number: { repositoryId: repo.id, number: prNumber } },
      update: { headSha, webhookReceivedAt: new Date(), isFeatureBranch },
      create: {
        repositoryId: repo.id,
        number: prNumber,
        headSha,
        webhookReceivedAt: new Date(),
        isFeatureBranch,
      },
    });

    // Respond immediately; analysis runs async via the queue (60s SLA tracked from this timestamp).
    await enqueueAnalysisJob({ repoFullName, prNumber, headSha, installationId });

    return res.status(200).json({ enqueued: true });
  } catch (err) {
    logger.error({ err, code: ErrorCodes.WEBHOOK_PAYLOAD_MALFORMED }, "failed to process webhook payload");
    return res.status(200).json({ enqueued: false, error: "malformed payload, not retried" });
  }
});
