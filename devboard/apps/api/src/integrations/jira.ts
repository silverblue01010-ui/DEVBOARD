import axios from "axios";
import { logger } from "../lib/logger";
import { Finding } from "@devboard/shared";

export interface JiraCreateIssueParams {
  baseUrl: string;
  apiToken: string;
  projectKey: string;
  finding: Finding;
  prUrl: string;
}

/**
 * Creates a Jira issue for a critical security finding (Phase 3).
 * apiToken is read from TeamConfig.jiraTokenEncrypted (decrypted by the caller) —
 * never stored or logged in plaintext here.
 */
export async function createJiraIssue(params: JiraCreateIssueParams): Promise<string | null> {
  const { baseUrl, apiToken, projectKey, finding, prUrl } = params;

  try {
    const { data } = await axios.post(
      `${baseUrl}/rest/api/3/issue`,
      {
        fields: {
          project: { key: projectKey },
          summary: `[DevBoard] ${finding.ruleId}: ${finding.message}`,
          description: `${finding.message}\n\nFile: ${finding.file}:${finding.line}\nPR: ${prUrl}`,
          issuetype: { name: "Bug" },
          priority: { name: "Critical" },
          labels: ["devboard", "security"],
        },
      },
      {
        auth: { username: "devboard", password: apiToken },
        timeout: 5000,
      }
    );
    return data.key;
  } catch (err) {
    logger.error({ err }, "failed to create Jira issue");
    return null;
  }
}
