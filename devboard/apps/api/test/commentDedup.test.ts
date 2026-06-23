import { applyNoiseBudget, noiseBudgetSummary } from "../src/dedup/commentDedup";
import type { Finding } from "@devboard/shared";

function makeFindings(n: number, severity: Finding["severity"]): Finding[] {
  return Array.from({ length: n }, (_, i) => ({
    ruleId: `RULE-${i}`,
    source: "RULE" as const,
    severity,
    file: `file${i}.ts`,
    line: i,
    message: "x",
    confidence: 0.9,
  }));
}

describe("applyNoiseBudget", () => {
  it("passes through findings under the 20-comment budget (passing case)", () => {
    const findings = makeFindings(5, "warning");
    const { toPost, truncatedCount } = applyNoiseBudget(findings);
    expect(toPost).toHaveLength(5);
    expect(truncatedCount).toBe(0);
  });

  it("caps at 20 and prioritizes critical severity first (failing/over-budget case)", () => {
    const criticals = makeFindings(5, "critical");
    const warnings = makeFindings(20, "warning");
    const { toPost, truncatedCount } = applyNoiseBudget([...warnings, ...criticals]);
    expect(toPost).toHaveLength(20);
    expect(truncatedCount).toBe(5);
    expect(toPost.slice(0, 5).every((f) => f.severity === "critical")).toBe(true);
  });

  it("handles exactly 20 findings as a boundary with zero truncation (edge case)", () => {
    const findings = makeFindings(20, "suggestion");
    const { toPost, truncatedCount } = applyNoiseBudget(findings);
    expect(toPost).toHaveLength(20);
    expect(truncatedCount).toBe(0);
  });
});

describe("noiseBudgetSummary", () => {
  it("returns null when nothing was truncated", () => {
    expect(noiseBudgetSummary(10, 0)).toBeNull();
  });

  it("returns a summary message naming the total and the cap when truncated", () => {
    const msg = noiseBudgetSummary(25, 5);
    expect(msg).toContain("25 total issues");
    expect(msg).toContain("top 20");
  });
});
