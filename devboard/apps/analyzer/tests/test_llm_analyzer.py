from app.llm.analyzer import _parse_llm_json


def test_parses_clean_json():
    result = _parse_llm_json('{"summary": "ok", "findings": [], "impactedModules": [], "suggestedReviewers": []}')
    assert result["summary"] == "ok"


def test_strips_markdown_code_fence():
    raw = '```json\n{"summary": "ok", "findings": []}\n```'
    result = _parse_llm_json(raw)
    assert result["summary"] == "ok"


def test_malformed_json_returns_empty_findings_without_raising():
    result = _parse_llm_json("not valid json at all {{{")
    assert result["findings"] == []
    assert result["summary"] == ""
