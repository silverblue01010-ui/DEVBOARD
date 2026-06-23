"""For each non-test file changed, checks whether a corresponding test file was
also changed. Suggestion severity only — never blocking (Phase 2 constraint)."""
from __future__ import annotations

import re

from app.diff_parser import ParsedFileDiff
from app.rules.engine import Finding

TEST_FILE_RE = re.compile(r"(\.test\.|\.spec\.|^test_|_test\.py$)")

FUNCTION_NAME_RE = {
    "python": re.compile(r"^\s*def\s+(\w+)\s*\("),
    "javascript": re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\("),
    "typescript": re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\("),
}


def _is_test_file(filename: str) -> bool:
    return bool(TEST_FILE_RE.search(filename))


def _likely_test_counterpart_changed(filename: str, changed_filenames: set[str]) -> bool:
    base = filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    for changed in changed_filenames:
        if _is_test_file(changed) and base in changed:
            return True
    return False


def _first_changed_function_name(file_diff: ParsedFileDiff) -> str | None:
    pattern = FUNCTION_NAME_RE.get(file_diff.language)
    if not pattern:
        return None
    for line in file_diff.added_lines():
        m = pattern.match(line.content)
        if m:
            return m.group(1)
    return None


def find_test_coverage_gaps(files: list[ParsedFileDiff]) -> list[Finding]:
    changed_filenames = {f.file for f in files}
    findings = []

    for file_diff in files:
        if _is_test_file(file_diff.file):
            continue
        if file_diff.language not in ("python", "javascript", "typescript"):
            continue
        if not file_diff.added_lines():
            continue
        if _likely_test_counterpart_changed(file_diff.file, changed_filenames):
            continue

        fn_name = _first_changed_function_name(file_diff)
        target = f" for {fn_name}" if fn_name else ""
        findings.append(
            Finding(
                rule_id="TESTCOV-001",
                source="RULE",
                severity="suggestion",
                file=file_diff.file,
                line=file_diff.added_lines()[0].line_number,
                message=f"This change has no corresponding test update. Consider adding/updating tests{target}.",
                why="Untested changes are more likely to regress silently in future refactors.",
                suggestion=f"Add or update a test{target} covering this change.",
                confidence=0.5,
            )
        )

    return findings
