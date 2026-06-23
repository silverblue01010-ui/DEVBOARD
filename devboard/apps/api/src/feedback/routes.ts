import { Router } from "express";
import { prisma } from "../lib/prisma";

export const feedbackRouter = Router();

/**
 * Called from the GitHub reaction webhook handler (wired in webhooks/github.ts in a full
 * build — kept as a direct endpoint here so it's independently testable).
 */
feedbackRouter.post("/reactions", async (req, res) => {
  const { findingId, userId, reaction } = req.body as {
    findingId: string;
    userId: string;
    reaction: "useful" | "irrelevant";
  };

  if (!findingId || !userId || !reaction) {
    return res.status(400).json({ error: "findingId, userId, reaction are required" });
  }

  await prisma.findingReaction.upsert({
    where: { findingId_userId: { findingId, userId } },
    update: { reaction },
    create: { findingId, userId, reaction },
  });

  res.status(200).json({ ok: true });
});

feedbackRouter.get("/rule-stats", async (_req, res) => {
  const findings = await prisma.finding.findMany({
    include: { reactions: true },
  });

  const byRule = new Map<string, { useful: number; total: number }>();
  for (const f of findings) {
    const entry = byRule.get(f.ruleId) || { useful: 0, total: 0 };
    for (const r of f.reactions) {
      entry.total += 1;
      if (r.reaction === "useful") entry.useful += 1;
    }
    byRule.set(f.ruleId, entry);
  }

  const stats = Array.from(byRule.entries()).map(([ruleId, { useful, total }]) => ({
    ruleId,
    precision: total > 0 ? useful / total : null,
    ratingsCount: total,
    // Rules with precision < 0.4 over 50+ ratings are auto-suppressed (Phase 2 constraint).
    autoSuppressed: total >= 50 && useful / total < 0.4,
  }));

  res.json({ stats });
});
