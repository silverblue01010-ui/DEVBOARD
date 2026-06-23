"""Calls the Claude API to find design/logic/security issues static rules miss.
LLM findings are always non-blocking — never request_changes (Phase 2 constraint).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import anthropic

from app.diff_parser import ParsedFileDiff, to_dict
from app.rules.engine import Finding

logger = logging.getLogger("devboard.llm")

PROMPT_PATH = Path(__file__).parent / "prompts" / "code_review_system.txt"
MAX_OUTPUT_TOKENS = 4000
LLM_TIMEOUT_SECONDS = 30
MIN_CONFIDENCE = 0.7
CHUNK_TOKEN_THRESHOLD = 8000
APPROX_CHARS_PER_TOKEN = 4


def _load_system_prompt() -> str:
    return PROMPT_PATH.read_text()


def _approx_tokens(text: str) -> int:
    return len(text) // APPROX_CHARS_PER_TOKEN


def _get_client() -> anthropic.Anthropic | None:
    """On-prem mode (Phase 6, Risk 2): LLM calls are disabled unless a self-hosted
    endpoint is configured. Cloud mode uses the standard Anthropic API."""
    mode = os.environ.get("DEVBOARD_MODE", "cloud")
    if mode == "onprem":
        endpoint = os.environ.get("DEVBOARD_LLM_ENDPOINT")
        if not endpoint:
            logger.info("DEVBOARD_MODE=onprem with no DEVBOARD_LLM_ENDPOINT set; skipping LLM analysis")
            return None
        return anthropic.Anthropic(base_url=endpoint, api_key=os.environ.get("ANTHROPIC_API_KEY", "unused"))

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        logger.warning("ANTHROPIC_API_KEY not set; skipping LLM analysis")
        return None
    return anthropic.Anthropic(api_key=api_key)


def _parse_llm_json(raw_text: str) -> dict:
    """Handles malformed JSON gracefully — strips markdown code fences if present,
    falls back to an empty-findings structure rather than raising (Phase 2 test req)."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        logger.warning("LLM returned malformed JSON, dropping LLM findings for this call: %s", exc)
        return {"summary": "", "findings": [], "impactedModules": [], "suggestedReviewers": []}


def _call_llm_once(client: anthropic.Anthropic, diff_chunk: list[dict], rule_findings: list[Finding]) -> dict:
    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    user_content = json.dumps(
        {
            "diff": diff_chunk,
            "existingFindings": [f.to_camel_case_dict() for f in rule_findings],
        }
    )

    try:
        response = client.messages.create(
            model=model,
            max_tokens=MAX_OUTPUT_TOKENS,
            system=_load_system_prompt(),
            messages=[{"role": "user", "content": user_content}],
            timeout=LLM_TIMEOUT_SECONDS,
        )
    except anthropic.APITimeoutError:
        logger.warning("LLM call timed out after %ss, skipping LLM findings for this chunk", LLM_TIMEOUT_SECONDS)
        return {"summary": "", "findings": [], "impactedModules": [], "suggestedReviewers": []}
    except anthropic.APIError as exc:
        logger.error("LLM call failed: %s", exc)
        return {"summary": "", "findings": [], "impactedModules": [], "suggestedReviewers": []}

    text_blocks = [b.text for b in response.content if getattr(b, "type", None) == "text"]
    raw_text = "\n".join(text_blocks)

    if hasattr(response, "usage"):
        total_tokens = (response.usage.input_tokens or 0) + (response.usage.output_tokens or 0)
        logger.info("LLM call used %s tokens", total_tokens)
        if total_tokens > 10_000:
            logger.warning("ALERT: single LLM job exceeded 10k tokens (%s)", total_tokens)

    return _parse_llm_json(raw_text)


def run_llm_analysis(files: list[ParsedFileDiff], rule_findings: list[Finding]) -> dict:
    """Returns {summary, findings: list[Finding], impactedModules, suggestedReviewers}.
    Chunks by file if the diff is large; merges findings across chunks."""
    added_total = sum(len(f.added_lines()) for f in files)
    if added_total == 0:
        return {"summary": "", "findings": [], "impactedModules": [], "suggestedReviewers": []}

    client = _get_client()
    if client is None:
        return {"summary": "", "findings": [], "impactedModules": [], "suggestedReviewers": []}

    diff_dicts = to_dict(files)
    full_text = json.dumps(diff_dicts)

    if _approx_tokens(full_text) <= CHUNK_TOKEN_THRESHOLD:
        chunks = [diff_dicts]
    else:
        chunks = [[d] for d in diff_dicts]  # one file per LLM call

    merged_findings: list[Finding] = []
    summary = ""
    impacted_modules: list[str] = []
    suggested_reviewers: list[str] = []

    for chunk in chunks:
        result = _call_llm_once(client, chunk, rule_findings)
        summary = summary or result.get("summary", "")
        impacted_modules.extend(result.get("impactedModules", []))
        suggested_reviewers.extend(result.get("suggestedReviewers", []))

        for raw in result.get("findings", []):
            confidence = float(raw.get("confidence", 0))
            if confidence < MIN_CONFIDENCE:
                continue  # Phase 2 constraint: drop findings with confidence < 0.7
            merged_findings.append(
                Finding(
                    rule_id=f"LLM-{raw.get('category', 'general').upper()}",
                    source="LLM",
                    severity=raw.get("severity", "suggestion"),
                    file=raw.get("file", "unknown"),
                    line=int(raw.get("line", 1)),
                    message=raw.get("message", ""),
                    why=raw.get("why"),
                    suggestion=raw.get("fix"),
                    confidence=confidence,
                )
            )

    return {
        "summary": summary,
        "findings": merged_findings,
        "impactedModules": sorted(set(impacted_modules)),
        "suggestedReviewers": sorted(set(suggested_reviewers)),
    }
