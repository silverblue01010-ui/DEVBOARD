import yaml from "js-yaml";
import { logger } from "../lib/logger";
import { ErrorCodes, DevBoardConfig, PolicyGate, Finding } from "@devboard/shared";

export interface GateEvalContext {
  findings: Finding[];
  changedFiles: string[];
  isFeatureBranch: boolean;
}

export interface GateResult {
  gate: PolicyGate;
  triggered: boolean;
}

export function parseConfig(rawYaml: string): DevBoardConfig {
  try {
    const parsed = yaml.load(rawYaml);
    return (parsed as DevBoardConfig) || {};
  } catch (err) {
    logger.error({ err, code: ErrorCodes.POLICY_CONFIG_PARSE_FAILED }, "failed to parse devboard.config.yml");
    return {};
  }
}

function countBySeverityAndCategory(findings: Finding[], severity: string, prefix?: string): number {
  return findings.filter(
    (f) => f.severity === severity && (!prefix || f.ruleId.startsWith(prefix))
  ).length;
}

function matchesGlob(file: string, pattern: string): boolean {
  // minimal glob support for the limited "**/dir/**" style patterns used in devboard.config.yml.
  // Order matters: ** must become a unique placeholder BEFORE the single-* replace runs,
  // otherwise the "*" inside ".*" gets re-matched and mangled by the second pass.
  const DOUBLE_STAR_PLACEHOLDER = "\u0000DOUBLESTAR\u0000";
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withPlaceholder = escaped.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);
  const withSingleStar = withPlaceholder.replace(/\*/g, "[^/]*");
  const finalPattern = withSingleStar.split(DOUBLE_STAR_PLACEHOLDER).join(".*");
  const regex = new RegExp("^" + finalPattern + "$");
  return regex.test(file);
}

/**
 * Evaluates a small expression language for gate conditions, supporting the
 * patterns shown in the Phase 3 example config:
 *   findings.critical.security > 0
 *   files.changed.matches("**\/routes/**")
 *   findings.suggestion.test_coverage > 0 AND pr.is_feature_branch
 */
function evalCondition(condition: string, ctx: GateEvalContext): boolean {
  const clauses = condition.split(/\s+AND\s+/i);
  return clauses.every((clause) => evalClause(clause.trim(), ctx));
}

function evalClause(clause: string, ctx: GateEvalContext): boolean {
  const filesMatch = clause.match(/files\.changed\.matches\(\s*["'](.+)["']\s*\)/);
  if (filesMatch) {
    const pattern = filesMatch[1];
    return ctx.changedFiles.some((f) => matchesGlob(f, pattern));
  }

  if (clause === "pr.is_feature_branch") {
    return ctx.isFeatureBranch;
  }

  const findingsMatch = clause.match(/findings\.(\w+)\.(\w+)\s*(>|>=|==)\s*(\d+)/);
  if (findingsMatch) {
    const [, severity, category, op, valueStr] = findingsMatch;
    const value = Number(valueStr);
    const prefixMap: Record<string, string | undefined> = {
      security: "SEC",
      test_coverage: "TESTCOV",
    };
    const count = countBySeverityAndCategory(ctx.findings, severity, prefixMap[category]);
    if (op === ">") return count > value;
    if (op === ">=") return count >= value;
    return count === value;
  }

  logger.warn({ clause }, "unrecognized gate condition clause, treating as false");
  return false;
}

export function evaluateGates(config: DevBoardConfig, ctx: GateEvalContext): GateResult[] {
  return (config.gates || []).map((gate) => ({
    gate,
    triggered: evalCondition(gate.condition, ctx),
  }));
}
