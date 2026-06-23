import { Finding } from "@devboard/shared";
import { InlineComment } from "../github/client";

/**
 * body format: "**[SEVERITY] RULE-ID** — {message}\n\n**Why it matters:** {why}\n\n**Suggested fix:** {suggestion}\n\n_Confidence: {confidence}_"
 */
export function formatFindingAsComment(finding: Finding & { isRepeatOfPriorCommit?: boolean; headSha?: string }): InlineComment {
  const why = finding.why || "This pattern is a common source of bugs or security issues.";
  const suggestion = finding.suggestion || "Review the flagged line and apply an appropriate fix.";

  const repeatNote = finding.isRepeatOfPriorCommit && finding.headSha
    ? `\n\n_Still present as of ${finding.headSha.slice(0, 7)}._`
    : "";

  const body = [
    `**[${finding.severity.toUpperCase()}] ${finding.ruleId}** — ${finding.message}`,
    "",
    `**Why it matters:** ${why}`,
    "",
    `**Suggested fix:** ${suggestion}`,
    "",
    `_Confidence: ${finding.confidence.toFixed(2)}_${repeatNote}`,
  ].join("\n");

  return { path: finding.file, line: finding.line, body };
}

export function reviewEventForFindings(findings: Finding[]): "REQUEST_CHANGES" | "COMMENT" {
  // SEC rules are always blocking; MAINT and STYLE (and all LLM/plugin findings) never are.
  const hasBlockingCritical = findings.some((f) => f.severity === "critical");
  return hasBlockingCritical ? "REQUEST_CHANGES" : "COMMENT";
}

export function checkRunSummary(findings: Finding[], fileCount: number): string {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warning = findings.filter((f) => f.severity === "warning").length;
  const suggestion = findings.filter((f) => f.severity === "suggestion").length;
  return `Found ${critical} critical, ${warning} warnings, ${suggestion} suggestions across ${fileCount} files`;
}

export function prSummaryComment(params: {
  summary: string;
  riskLevel: "low" | "medium" | "high";
  impactedModules: string[];
  suggestedReviewers: string[];
  criticalCount: number;
  warningCount: number;
  llmSuggestionCount: number;
}): string {
  const { summary, riskLevel, impactedModules, suggestedReviewers, criticalCount, warningCount, llmSuggestionCount } = params;
  return [
    "### 🤖 DevBoard PR Summary",
    "",
    summary,
    "",
    `**Risk level:** ${riskLevel}`,
    impactedModules.length ? `**Impacted modules:** ${impactedModules.join(", ")}` : "",
    suggestedReviewers.length ? `**Suggested reviewers:** ${suggestedReviewers.join(", ")}` : "",
    "",
    `**Findings:** ${criticalCount} critical (blocking), ${warningCount} warnings, ${llmSuggestionCount} ML suggestions`,
  ]
    .filter(Boolean)
    .join("\n");
}
