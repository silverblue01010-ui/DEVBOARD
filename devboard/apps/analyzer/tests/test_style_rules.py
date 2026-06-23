from app.diff_parser import ParsedFileDiff, DiffHunk, DiffLine
from app.rules.style import rule_style_001_magic_numbers, rule_style_002_single_char_names


def _file(language: str, added_lines: list[str], filename="src/app.py") -> ParsedFileDiff:
    f = ParsedFileDiff(file=filename, language=language)
    hunk = DiffHunk(old_start=1, new_start=1)
    hunk.lines = [DiffLine(type="add", content=c, line_number=i + 1) for i, c in enumerate(added_lines)]
    f.hunks = [hunk]
    return f


def test_style_001_flags_unexplained_numeric_literal():
    f = _file("python", ["timeout = 4327"])
    findings = rule_style_001_magic_numbers(f)
    assert len(findings) == 1
    assert findings[0].severity == "suggestion"


def test_style_001_does_not_flag_allowed_numbers():
    f = _file("python", ["count = 0", "index = -1", "step = 1"])
    findings = rule_style_001_magic_numbers(f)
    assert findings == []


def test_style_001_edge_case_skips_comment_lines():
    f = _file("python", ["# retry after 4327 ms"])
    findings = rule_style_001_magic_numbers(f)
    assert findings == []


def test_style_002_flags_single_character_variable():
    f = _file("javascript", ["let x = computeValue();"], filename="src/app.js")
    findings = rule_style_002_single_char_names(f)
    assert len(findings) == 1


def test_style_002_does_not_flag_descriptive_name():
    f = _file("javascript", ["let total = computeValue();"], filename="src/app.js")
    findings = rule_style_002_single_char_names(f)
    assert findings == []


def test_style_002_edge_case_excludes_loop_counters():
    f = _file("javascript", ["let i = 0;"], filename="src/app.js")
    findings = rule_style_002_single_char_names(f)
    assert findings == []
