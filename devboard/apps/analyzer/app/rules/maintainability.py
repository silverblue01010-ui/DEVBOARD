"""Maintainability rules. All findings here are severity=warning — never blocking
per the Phase 1 constraint (MAINT and STYLE are never blocking)."""
from __future__ import annotations

import re

from app.diff_parser import ParsedFileDiff
from app.rules.engine import Finding

FUNCTION_DEF_RE = {
    "python": re.compile(r"^\s*def\s+\w+\s*\("),
    "javascript": re.compile(r"^\s*(async\s+)?function\s+\w+\s*\(|^\s*(export\s+)?(const|let)\s+\w+\s*=\s*(async\s*)?\("),
    "typescript": re.compile(r"^\s*(async\s+)?function\s+\w+\s*\(|^\s*(export\s+)?(const|let)\s+\w+\s*=\s*(async\s*)?\("),
}
TODO_RE = re.compile(r"\b(TODO|FIXME|HACK)\b")
PRINT_RE = re.compile(r"^\s*console\.log\(|^\s*print\(")
TEST_FILE_RE = re.compile(r"(\.test\.|\.spec\.|^test_|_test\.py$)")

MAX_FUNCTION_LINES = 50


def rule_maint_001_long_function(file_diff: ParsedFileDiff) -> list[Finding]:
    pattern = FUNCTION_DEF_RE.get(file_diff.language)
    if not pattern:
        return []

    findings = []
    for hunk in file_diff.hunks:
        added = [ln for ln in hunk.lines if ln.type == "add"]
        run_start = None
        for i, line in enumerate(added):
            if pattern.match(line.content):
                if run_start is not None:
                    _maybe_flag(findings, file_diff, added, run_start, i)
                run_start = i
        if run_start is not None:
            _maybe_flag(findings, file_diff, added, run_start, len(added))
    return findings


def _maybe_flag(findings, file_diff, added, start, end):
    length = end - start
    if length > MAX_FUNCTION_LINES:
        findings.append(
            Finding(
                rule_id="MAINT-001",
                source="RULE",
                severity="warning",
                file=file_diff.file,
                line=added[start].line_number,
                message=f"Function is {length} lines long in this diff (limit: {MAX_FUNCTION_LINES})",
                why="Long functions are harder to test, review, and reason about; they often mix multiple responsibilities.",
                suggestion="Extract cohesive blocks into smaller, named helper functions.",
                confidence=0.6,
            )
        )


def rule_maint_002_todo_comments(file_diff: ParsedFileDiff) -> list[Finding]:
    findings = []
    for line in file_diff.added_lines():
        if TODO_RE.search(line.content):
            findings.append(
                Finding(
                    rule_id="MAINT-002",
                    source="RULE",
                    severity="warning",
                    file=file_diff.file,
                    line=line.line_number,
                    message="TODO/FIXME/HACK comment added in new code",
                    why="Unresolved TODOs tend to accumulate silently and signal known-incomplete work shipping to production.",
                    suggestion="Resolve before merge, or open a tracked issue and reference it in the comment.",
                    confidence=0.8,
                )
            )
    return findings


def rule_maint_003_debug_statements(file_diff: ParsedFileDiff) -> list[Finding]:
    if TEST_FILE_RE.search(file_diff.file):
        return []
    findings = []
    for line in file_diff.added_lines():
        if PRINT_RE.search(line.content):
            findings.append(
                Finding(
                    rule_id="MAINT-003",
                    source="RULE",
                    severity="warning",
                    file=file_diff.file,
                    line=line.line_number,
                    message="console.log/print statement left in non-test code",
                    why="Debug statements left in production code add noise to logs and can leak internal state.",
                    suggestion="Remove the debug statement or replace it with a proper logger call at an appropriate level.",
                    confidence=0.85,
                )
            )
    return findings


MAINTAINABILITY_RULES = [
    rule_maint_001_long_function,
    rule_maint_002_todo_comments,
    rule_maint_003_debug_statements,
]
