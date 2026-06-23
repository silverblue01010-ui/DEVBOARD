from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Callable

from app.diff_parser import ParsedFileDiff

Severity = str  # "critical" | "warning" | "suggestion"


@dataclass
class Finding:
    rule_id: str
    source: str  # "RULE" | "LLM" | "PLUGIN"
    severity: Severity
    file: str
    line: int
    message: str
    confidence: float
    why: str | None = None
    suggestion: str | None = None

    def to_camel_case_dict(self) -> dict:
        """Matches the shared TS Finding contract (camelCase) sent back to apps/api."""
        d = asdict(self)
        return {
            "ruleId": d["rule_id"],
            "source": d["source"],
            "severity": d["severity"],
            "file": d["file"],
            "line": d["line"],
            "message": d["message"],
            "why": d["why"],
            "suggestion": d["suggestion"],
            "confidence": d["confidence"],
        }


RuleFn = Callable[[ParsedFileDiff], list[Finding]]


def run_rules(rules: list[RuleFn], files: list[ParsedFileDiff]) -> list[Finding]:
    """Runs each rule against each file's diff. A single rule raising must never
    take down the whole analysis — caught and logged, contributing zero findings."""
    findings: list[Finding] = []
    for file_diff in files:
        for rule in rules:
            try:
                findings.extend(rule(file_diff))
            except Exception as exc:  # defensive: one bad rule shouldn't fail the job
                import logging

                logging.getLogger("devboard.rules").warning(
                    "rule %s raised on %s: %s", getattr(rule, "__name__", rule), file_diff.file, exc
                )
    return findings


def run_all_static_rules(files: list[ParsedFileDiff]) -> list[Finding]:
    from app.rules.security import SECURITY_RULES
    from app.rules.maintainability import MAINTAINABILITY_RULES
    from app.rules.style import STYLE_RULES

    return run_rules(SECURITY_RULES + MAINTAINABILITY_RULES + STYLE_RULES, files)
