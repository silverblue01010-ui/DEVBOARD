from __future__ import annotations

import logging

from fastapi import FastAPI
from pydantic import BaseModel

from app.diff_parser import parse_unified_diff
from app.rules.engine import run_all_static_rules, Finding
from app.llm.analyzer import run_llm_analysis
from app.test_coverage import find_test_coverage_gaps
from app.sanitize import sanitize_diff

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("devboard.analyzer")

app = FastAPI(title="DevBoard Analyzer")


class AnalyzeRequest(BaseModel):
    repoFullName: str
    prNumber: int
    headSha: str
    diff: str
    isFeatureBranch: bool = True


class AnalyzeResponse(BaseModel):
    ruleFindings: list[dict]
    llmFindings: list[dict]
    summary: str
    riskLevel: str
    impactedModules: list[str]
    suggestedReviewers: list[str]
    testCoverageGaps: list[dict]


@app.get("/health")
def health():
    return {"status": "ok"}


def _derive_risk_level(rule_findings: list[Finding], llm_critical_signal: bool, impacted_count: int) -> str:
    critical_count = sum(1 for f in rule_findings if f.severity == "critical")
    if critical_count > 0 or llm_critical_signal:
        return "high"
    if impacted_count > 3:
        return "medium"
    return "low"


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest) -> AnalyzeResponse:
    files = parse_unified_diff(req.diff)

    # Phase 1: rule-based analysis (no ML)
    rule_findings = run_all_static_rules(files)

    # Phase 2: LLM-powered contextual analysis. Diff content is sanitized first
    # (Phase 6, Risk 2) — emails, IPs, private keys, and cloud credentials are
    # stripped before anything leaves the process boundary toward the LLM.
    sanitized_files = files
    for f in files:
        for hunk in f.hunks:
            for line in hunk.lines:
                line.content, _ = sanitize_diff(line.content)

    llm_result = run_llm_analysis(sanitized_files, rule_findings)
    llm_findings: list[Finding] = llm_result["findings"]

    # Phase 2: test coverage gap detection
    test_gaps = find_test_coverage_gaps(files)

    impacted_modules = llm_result.get("impactedModules", [])
    risk_level = _derive_risk_level(rule_findings, bool(llm_findings) and any(
        f.severity == "warning" and f.rule_id == "LLM-SECURITY" for f in llm_findings
    ), len(impacted_modules))

    return AnalyzeResponse(
        ruleFindings=[f.to_camel_case_dict() for f in rule_findings],
        llmFindings=[f.to_camel_case_dict() for f in llm_findings],
        summary=llm_result.get("summary", "") or f"This PR modifies {len(files)} file(s).",
        riskLevel=risk_level,
        impactedModules=impacted_modules,
        suggestedReviewers=llm_result.get("suggestedReviewers", []),
        testCoverageGaps=[f.to_camel_case_dict() for f in test_gaps],
    )
