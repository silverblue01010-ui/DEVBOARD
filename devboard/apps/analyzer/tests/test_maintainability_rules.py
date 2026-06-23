from app.diff_parser import ParsedFileDiff, DiffHunk, DiffLine
from app.rules.maintainability import (
    rule_maint_001_long_function,
    rule_maint_002_todo_comments,
    rule_maint_003_debug_statements,
)


def _file(language: str, added_lines: list[str], filename="src/app.py") -> ParsedFileDiff:
    f = ParsedFileDiff(file=filename, language=language)
    hunk = DiffHunk(old_start=1, new_start=1)
    hunk.lines = [DiffLine(type="add", content=c, line_number=i + 1) for i, c in enumerate(added_lines)]
    f.hunks = [hunk]
    return f


def test_maint_001_flags_function_over_50_lines():
    lines = ["def big_function():"] + [f"    x = {i}" for i in range(60)]
    f = _file("python", lines)
    findings = rule_maint_001_long_function(f)
    assert len(findings) == 1
    assert findings[0].severity == "warning"


def test_maint_001_does_not_flag_short_function():
    lines = ["def small_function():", "    return 1"]
    f = _file("python", lines)
    findings = rule_maint_001_long_function(f)
    assert findings == []


def test_maint_001_edge_case_exactly_50_lines_is_not_flagged():
    lines = ["def boundary_function():"] + [f"    x = {i}" for i in range(49)]  # 50 total incl def
    f = _file("python", lines)
    findings = rule_maint_001_long_function(f)
    assert findings == []


def test_maint_002_flags_todo_comment():
    f = _file("python", ["# TODO: handle null case"])
    findings = rule_maint_002_todo_comments(f)
    assert len(findings) == 1
    assert findings[0].rule_id == "MAINT-002"


def test_maint_002_does_not_flag_normal_comment():
    f = _file("python", ["# this explains the logic below"])
    findings = rule_maint_002_todo_comments(f)
    assert findings == []


def test_maint_002_edge_case_word_boundary_with_trailing_comment():
    f = _file("python", ["x = 1  # FIXME"])
    findings = rule_maint_002_todo_comments(f)
    assert len(findings) == 1


def test_maint_003_flags_console_log():
    f = _file("javascript", ["console.log(debugValue);"], filename="src/app.js")
    findings = rule_maint_003_debug_statements(f)
    assert len(findings) == 1


def test_maint_003_does_not_flag_in_test_file():
    f = _file("javascript", ["console.log(debugValue);"], filename="src/app.test.js")
    findings = rule_maint_003_debug_statements(f)
    assert findings == []


def test_maint_003_edge_case_print_in_python():
    f = _file("python", ["print(result)"])
    findings = rule_maint_003_debug_statements(f)
    assert len(findings) == 1
