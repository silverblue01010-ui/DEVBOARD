// @devboard/shared — types shared between apps/api, packages/cli, and (via JSON contract) apps/analyzer.

export type Severity = "critical" | "warning" | "suggestion";
export type FindingSource = "RULE" | "LLM" | "PLUGIN";

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: number;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  file: string;
  language: string;
  hunks: DiffHunk[];
}

export interface Finding {
  ruleId: string;
  source: FindingSource;
  severity: Severity;
  file: string;
  line: number;
  message: string;
  why?: string;
  suggestion?: string;
  confidence: number;
}

export interface AnalyzeRequest {
  repoFullName: string;
  prNumber: number;
  headSha: string;
  diff: string;
  isFeatureBranch?: boolean;
}

export interface AnalyzeResponse {
  ruleFindings: Finding[];
  llmFindings: Finding[];
  summary: string;
  riskLevel: "low" | "medium" | "high";
  impactedModules: string[];
  suggestedReviewers: string[];
  testCoverageGaps: Finding[];
}

export interface AnalysisJobPayload {
  repoFullName: string;
  prNumber: number;
  headSha: string;
  installationId: string;
}

export interface PolicyGate {
  id: string;
  description?: string;
  condition: string;
  action: "block" | "warn" | "assign_reviewer";
  reviewer_role?: string;
}

export interface DevBoardConfig {
  gates?: PolicyGate[];
  notifications?: {
    mode?: "inline" | "digest";
    slack?: {
      webhook_url?: string;
      channel?: string;
      on?: string[];
    };
  };
  integrations?: {
    jira?: {
      base_url?: string;
      project_key?: string;
      api_token?: string;
    };
  };
  plugins?: {
    name: string;
    path: string;
    language: "node" | "python";
  }[];
}
