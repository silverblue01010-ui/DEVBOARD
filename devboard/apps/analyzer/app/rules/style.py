"""Style rules. All findings here are severity=suggestion — never blocking."""
from __future__ import annotations

import re

from app.diff_parser import ParsedFileDiff
from app.rules.engine import Finding

MAGIC_NUMBER_RE = re.compile(r"(?<![\w.])(-?\d+\.?\d*)(?![\w.])")
ALLOWED_NUMBERS = {"0", "1", "-1"}
SINGLE_CHAR_VAR_RE = re.compile(r"\b(?:var|let|const|int|float|double|def)\s+([a-zA-Z])\b|function\s+([a-zA-Z])\s*\(")
LOOP_COUNTERS = {"i", "j", "k"}


def rule_style_001_magic_numbers(file_diff: ParsedFileDiff) -> list[Finding]:
    findings = []
    for line in file_diff.added_lines():
        stripped = line.content.strip()
        if stripped.startswith(("//", "#", "*")):
            continue
        for match in MAGIC_NUMBER_RE.finditer(stripped):
            if match.group(1) not in ALLOWED_NUMBERS:
                findings.append(
                    Finding(
                        rule_id="STYLE-001",
                        source="RULE",
                        severity="suggestion",
                        file=file_diff.file,
                        line=line.line_number,
                        message=f"Magic number {match.group(1)} without an explanatory name",
                        why="Unnamed numeric literals obscure intent and are easy to typo when duplicated elsewhere.",
                        suggestion="Extract the value into a named constant.",
                        confidence=0.4,
                    )
                )
                break  # one finding per line is enough signal
    return findings


def rule_style_002_single_char_names(file_diff: ParsedFileDiff) -> list[Finding]:
    findings = []
    for line in file_diff.added_lines():
        match = SINGLE_CHAR_VAR_RE.search(line.content)
        if match:
            name = match.group(1) or match.group(2)
            if name and name not in LOOP_COUNTERS:
                findings.append(
                    Finding(
                        rule_id="STYLE-002",
                        source="RULE",
                        severity="suggestion",
                        file=file_diff.file,
                        line=line.line_number,
                        message=f"Single-character identifier '{name}'",
                        why="Single-letter names (outside loop counters) make code harder to search and understand later.",
                        suggestion="Use a descriptive name that conveys intent.",
                        confidence=0.5,
                    )
                )
    return findings


STYLE_RULES = [
    rule_style_001_magic_numbers,
    rule_style_002_single_char_names,
]
