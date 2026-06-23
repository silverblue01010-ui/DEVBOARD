from app.diff_parser import ParsedFileDiff, DiffHunk, DiffLine
from app.rules.security import rule_sec_001_hardcoded_secrets, rule_sec_002_sql_injection, rule_sec_003_xss


def _file(language: str, added_lines: list[str], filename="src/app.py") -> ParsedFileDiff:
    f = ParsedFileDiff(file=filename, language=language)
    hunk = DiffHunk(old_start=1, new_start=1)
    hunk.lines = [DiffLine(type="add", content=c, line_number=i + 1) for i, c in enumerate(added_lines)]
    f.hunks = [hunk]
    return f


def test_sec_001_flags_hardcoded_password():
    f = _file("python", ['password = "sup3rSecret!"'])
    findings = rule_sec_001_hardcoded_secrets(f)
    assert len(findings) == 1
    assert findings[0].rule_id == "SEC-001"
    assert findings[0].severity == "critical"


def test_sec_001_does_not_flag_env_var_reference():
    f = _file("python", ['password = os.environ["DB_PASSWORD"]'])
    findings = rule_sec_001_hardcoded_secrets(f)
    assert findings == []


def test_sec_001_edge_case_short_value_below_threshold():
    # 5-char value is below the 6-char minimum in the pattern — should not flag
    f = _file("python", ['token = "abc12"'])
    findings = rule_sec_001_hardcoded_secrets(f)
    assert findings == []


def test_sec_002_flags_string_concatenation_in_query():
    f = _file("python", ['query = "SELECT * FROM users WHERE id = " + user_id'])
    findings = rule_sec_002_sql_injection(f)
    assert len(findings) == 1
    assert findings[0].rule_id == "SEC-002"


def test_sec_002_does_not_flag_parameterized_query():
    f = _file("python", ["cursor.execute('SELECT * FROM users WHERE id = %s', (user_id,))"])
    findings = rule_sec_002_sql_injection(f)
    assert findings == []


def test_sec_002_edge_case_skips_non_sql_languages():
    f = _file("yaml", ['query: "SELECT * FROM users" + user_id'])
    findings = rule_sec_002_sql_injection(f)
    assert findings == []


def test_sec_003_flags_inner_html_assignment():
    f = _file("javascript", ["el.innerHTML = userInput;"])
    findings = rule_sec_003_xss(f)
    assert len(findings) == 1
    assert findings[0].rule_id == "SEC-003"


def test_sec_003_does_not_flag_text_content():
    f = _file("javascript", ["el.textContent = userInput;"])
    findings = rule_sec_003_xss(f)
    assert findings == []


def test_sec_003_edge_case_skips_non_js_languages():
    f = _file("python", ["el.innerHTML = user_input"])
    findings = rule_sec_003_xss(f)
    assert findings == []
