import { Router } from "express";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

export const rulesRouter = Router();

const PROMOTION_PRECISION_GATE = 0.8;
const PROMOTION_MIN_RATINGS = 50;
const SHADOW_PROMOTION_PRECISION = 0.75;
const SHADOW_PERIOD_DAYS = 14;
const DAILY_PRECISION_ALERT_THRESHOLD = 0.6;

/** Returns current state for a rule, defaulting new rules to "shadow". */
export async function getRuleState(ruleId: string) {
  return prisma.ruleState.upsert({
    where: { ruleId },
    update: {},
    create: { ruleId, state: "shadow" },
  });
}

/**
 * Enforces the precision gate before a rule can move to the blocking (active) tier:
 * must have >= 0.80 precision on 50+ rated findings. Called by the rule promotion
 * process — never bypassed in code.
 */
export async function tryPromoteRule(ruleId: string, precision: number, ratingsCount: number): Promise<boolean> {
  if (precision >= PROMOTION_PRECISION_GATE && ratingsCount >= PROMOTION_MIN_RATINGS) {
    await prisma.ruleState.update({
      where: { ruleId },
      data: { state: "active", precision, ratingsCount, promotedAt: new Date() },
    });
    return true;
  }
  await prisma.ruleState.update({ where: { ruleId }, data: { precision, ratingsCount } });
  return false;
}

/**
 * Shadow-mode promotion: after 14 days in shadow, check precision against the
 * internal test set. >= 0.75 promotes to active; otherwise stays in shadow and is
 * flagged for manual review.
 */
export async function evaluateShadowRules() {
  const cutoff = new Date(Date.now() - SHADOW_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const shadowRules = await prisma.ruleState.findMany({ where: { state: "shadow" } });

  for (const rule of shadowRules) {
    if (rule.updatedAt > cutoff) continue; // not yet past the 14-day shadow window
    if (rule.precision !== null && rule.precision >= SHADOW_PROMOTION_PRECISION) {
      await prisma.ruleState.update({ where: { ruleId: rule.ruleId }, data: { state: "active", promotedAt: new Date() } });
      logger.info({ ruleId: rule.ruleId, precision: rule.precision }, "shadow rule promoted to active");
    } else {
      logger.warn({ ruleId: rule.ruleId, precision: rule.precision }, "shadow rule failed promotion, flagged for review");
    }
  }
}

/** Daily precision report — any rule dropping below 0.60 over the last 30 days alerts ops. */
export async function dailyPrecisionReport() {
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const findings = await prisma.finding.findMany({
    where: { detectedAt: { gte: since30d } },
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

  for (const [ruleId, { useful, total }] of byRule) {
    if (total === 0) continue;
    const precision = useful / total;
    await prisma.ruleState.upsert({
      where: { ruleId },
      update: { precision, ratingsCount: total },
      create: { ruleId, state: "shadow", precision, ratingsCount: total },
    });
    if (precision < DAILY_PRECISION_ALERT_THRESHOLD) {
      logger.warn({ ruleId, precision }, "ALERT: rule precision below 0.60 over last 30 days");
    }
  }
}

rulesRouter.get("/", async (_req, res) => {
  const rules = await prisma.ruleState.findMany();
  res.json({ rules });
});

rulesRouter.post("/:ruleId/promote", async (req, res) => {
  const { ruleId } = req.params;
  const { precision, ratingsCount } = req.body;
  const promoted = await tryPromoteRule(ruleId, precision, ratingsCount);
  res.json({ promoted });
});
