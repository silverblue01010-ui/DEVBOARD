import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { redis } from "../lib/redis";
import { logger } from "../lib/logger";
import { trackRateLimit, isThrottled } from "./rateLimit";
import { ErrorCodes } from "@devboard/shared";

const INSTALLATION_TOKEN_TTL_BUFFER_MS = 5 * 60 * 1000; // never use a token expiring within 5 min

function tokenCacheKey(installationId: string) {
  return `devboard:installation-token:${installationId}`;
}

/**
 * Returns a cached installation token if one is valid for >5 more minutes,
 * otherwise mints a new one via the GitHub Apps auth flow and caches it.
 */
export async function getInstallationToken(installationId: string): Promise<string> {
  const cached = await redis.get(tokenCacheKey(installationId));
  if (cached) {
    const { token, expiresAt } = JSON.parse(cached);
    if (Date.now() < expiresAt - INSTALLATION_TOKEN_TTL_BUFFER_MS) {
      return token;
    }
  }

  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: (process.env.GITHUB_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  });

  try {
    const result = await auth({ type: "installation", installationId: Number(installationId) });
    const expiresAt = new Date(result.expiresAt).getTime();
    await redis.set(
      tokenCacheKey(installationId),
      JSON.stringify({ token: result.token, expiresAt }),
      "PX",
      expiresAt - Date.now()
    );
    return result.token;
  } catch (err) {
    logger.error({ err, code: ErrorCodes.GITHUB_TOKEN_FETCH_FAILED, installationId }, "failed to mint installation token");
    throw err;
  }
}

export async function getOctokit(installationId: string): Promise<Octokit> {
  if (await isThrottled(installationId)) {
    throw new Error(`installation ${installationId} is throttled, requeue with delay`);
  }
  const token = await getInstallationToken(installationId);
  const octokit = new Octokit({ auth: token });

  // Hook every request/response so we can read rate-limit headers (Phase 6, Risk 3)
  octokit.hook.after("request", async (response) => {
    await trackRateLimit(installationId, response.headers as Record<string, string>);
  });

  return octokit;
}

function diffCacheKey(repoFullName: string, headSha: string) {
  return `devboard:diff:${repoFullName}:${headSha}`;
}

/**
 * Fetches the raw unified diff for a PR. Cached for 1 hour keyed by head SHA,
 * since the same commit always produces the same diff (Phase 6, Risk 3).
 */
export async function getPRDiff(
  installationId: string,
  repoFullName: string,
  prNumber: number,
  headSha: string
): Promise<string> {
  const cached = await redis.get(diffCacheKey(repoFullName, headSha));
  if (cached) return cached;

  const [owner, repo] = repoFullName.split("/");
  const octokit = await getOctokit(installationId);

  const { data } = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
    owner,
    repo,
    pull_number: prNumber,
    headers: { accept: "application/vnd.github.v3.diff" },
  });

  const diff = data as unknown as string;
  await redis.set(diffCacheKey(repoFullName, headSha), diff, "EX", 3600);
  return diff;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Posts all findings as a single GitHub Review (not individual comments) to avoid
 * notification spam, per Phase 1 constraint.
 */
export async function postReviewComment(
  installationId: string,
  repoFullName: string,
  prNumber: number,
  headSha: string,
  comments: InlineComment[],
  event: "REQUEST_CHANGES" | "COMMENT" | "APPROVE"
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getOctokit(installationId);

  if (comments.length === 0) {
    return octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      event: "COMMENT",
      body: "DevBoard found no issues in this diff.",
    });
  }

  return octokit.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    commit_id: headSha,
    event,
    comments: comments.map((c) => ({ path: c.path, line: c.line, body: c.body })),
  });
}

export async function postCheckRun(
  installationId: string,
  repoFullName: string,
  headSha: string,
  status: "in_progress" | "completed",
  conclusion: "success" | "failure" | "neutral" | undefined,
  output: { title: string; summary: string }
) {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getOctokit(installationId);

  return octokit.checks.create({
    owner,
    repo,
    name: "DevBoard",
    head_sha: headSha,
    status,
    conclusion,
    output,
  });
}

export async function postOrUpdateTopLevelComment(
  installationId: string,
  repoFullName: string,
  prNumber: number,
  existingCommentId: number | undefined,
  body: string
): Promise<number> {
  const [owner, repo] = repoFullName.split("/");
  const octokit = await getOctokit(installationId);

  if (existingCommentId) {
    const { data } = await octokit.issues.updateComment({
      owner,
      repo,
      comment_id: existingCommentId,
      body,
    });
    return data.id;
  }

  const { data } = await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
  return data.id;
}
