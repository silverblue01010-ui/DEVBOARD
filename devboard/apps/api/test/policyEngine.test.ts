import { parseConfig, evaluateGates } from "../src/policy/engine";
import type { Finding } from "@devboard/shared";

const sampleYaml = `
gates:
  - id: no-critical-security
    description: "Block merge if any critical security finding"
    condition: findings.critical.security > 0
    action: block

  - id: require-senior-review
    description: "API route changes need senior approval"
    condition: files.changed.matches("**/routes/**")
    action: assign_reviewer
    reviewer_role: "senior backend engineer"
`;

const secFinding: Finding = {
  ruleId: "SEC-001",
  source: "RULE",
  severity: "critical",
  file: "src/routes/payments.ts",
  line: 10,
  message: "Hardcoded secret",
  confidence: 0.95,
};

describe("policy engine", () => {
  it("parses devboard.config.yml into gates", () => {
    const config = parseConfig(sampleYaml);
    expect(config.gates).toHaveLength(2);
  });

  it("triggers the block gate when a critical security finding is present (passing case)", () => {
    const config = parseConfig(sampleYaml);
    const results = evaluateGates(config, { findings: [secFinding], changedFiles: [secFinding.file], isFeatureBranch: true });
    const blockGate = results.find((r) => r.gate.id === "no-critical-security");
    expect(blockGate?.triggered).toBe(true);
  });

  it("does not trigger the block gate with zero critical security findings (failing case)", () => {
    const config = parseConfig(sampleYaml);
    const results = evaluateGates(config, { findings: [], changedFiles: [], isFeatureBranch: true });
    const blockGate = results.find((r) => r.gate.id === "no-critical-security");
    expect(blockGate?.triggered).toBe(false);
  });

  it("triggers the file-pattern gate only for matching paths (edge case: nested routes dir)", () => {
    const config = parseConfig(sampleYaml);
    const results = evaluateGates(config, {
      findings: [],
      changedFiles: ["src/api/v1/routes/users.ts"],
      isFeatureBranch: true,
    });
    const reviewGate = results.find((r) => r.gate.id === "require-senior-review");
    expect(reviewGate?.triggered).toBe(true);
  });

  it("returns an empty array and logs rather than throwing on malformed yaml", () => {
    const config = parseConfig("not: [valid, yaml: structure");
    expect(evaluateGates(config, { findings: [], changedFiles: [], isFeatureBranch: true })).toEqual([]);
  });
});
