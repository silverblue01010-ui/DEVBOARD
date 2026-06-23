import { formatFindingAsComment, reviewEventForFindings, checkRunSummary } from "../src/queue/commentFormatter";
import type { Finding } from "@devboard/shared";

const baseFinding: Finding = {
  ruleId: "SEC-001",
  source: "RULE",
  severity: "critical",
  file: "src/app.ts",
  line: 42,
  message: "Hardcoded secret detected",
  why: "Secrets in source code can leak via git history or logs.",
  suggestion: "Move the value to an environment variable.",
  confidence: 0.95,
};

describe("formatFindingAsComment", () => {
  it("includes severity, ruleId, message, why, suggestion, and confidence", () => {
    const comment = formatFindingAsComment(baseFinding);
    expect(comment.path).toBe("src/app.ts");
    expect(comment.line).toBe(42);
    expect(comment.body).toContain("[CRITICAL] SEC-001");
    expect(comment.body).toContain("Hardcoded secret detected");
    expect(comment.body).toContain("Why it matters:");
    expect(comment.body).toContain("Suggested fix:");
    expect(comment.body).toContain("Confidence: 0.95");
  });

  it("appends a 'still present' note when isRepeatOfPriorCommit is true", () => {
    const comment = formatFindingAsComment({ ...baseFinding, isRepeatOfPriorCommit: true, headSha: "abcdef1234567" });
    expect(comment.body).toContain("Still present as of abcdef1");
  });

  it("falls back to default why/suggestion text when absent", () => {
    const { why, suggestion, ...rest } = baseFinding;
    const comment = formatFindingAsComment(rest as Finding);
    expect(comment.body).toContain("common source of bugs");
    expect(comment.body).toContain("Review the flagged line");
  });
});

describe("reviewEventForFindings", () => {
  it("requests changes when any critical finding is present", () => {
    expect(reviewEventForFindings([baseFinding])).toBe("REQUEST_CHANGES");
  });

  it("only comments when no critical findings are present (edge case: empty list)", () => {
    expect(reviewEventForFindings([])).toBe("COMMENT");
  });

  it("only comments when findings are warning/suggestion severity", () => {
    const warn: Finding = { ...baseFinding, severity: "warning" };
    expect(reviewEventForFindings([warn])).toBe("COMMENT");
  });
});

describe("checkRunSummary", () => {
  it("counts findings by severity across files", () => {
    const findings: Finding[] = [
      baseFinding,
      { ...baseFinding, severity: "warning", ruleId: "MAINT-001" },
      { ...baseFinding, severity: "suggestion", ruleId: "STYLE-001" },
    ];
    expect(checkRunSummary(findings, 2)).toBe("Found 1 critical, 1 warnings, 1 suggestions across 2 files");
  });
});
