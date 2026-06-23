import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";

/**
 * Per-repo API key auth. Key format: "{repoId}.{secret}". We store only a salted
 * hash of the secret, never the secret itself (TeamConfig is reused loosely here;
 * in a full build this would be its own ApiKey table — kept simple for this scaffold).
 */
export async function requireRepoApiKey(req: Request, res: Response, next: NextFunction) {
  const header = req.header("x-api-key");
  const repoParam = (req.query.repo as string) || "";
  if (!header || !repoParam) {
    return res.status(401).json({ error: "missing x-api-key or repo query param" });
  }

  const repo = await prisma.repository.findUnique({ where: { fullName: repoParam } });
  if (!repo) return res.status(404).json({ error: "unknown repo" });

  const expected = crypto
    .createHmac("sha256", process.env.API_KEY_SALT || "change-me-in-prod")
    .update(repo.id)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(header.padEnd(expected.length, "0").slice(0, expected.length)))) {
    return res.status(403).json({ error: "invalid api key for this repo" });
  }

  (req as any).repo = repo;
  next();
}
