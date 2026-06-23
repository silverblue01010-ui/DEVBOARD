"""Strips sensitive content from diffs before they are sent to the Claude API.
Logs *what category* was stripped, never the original content (Phase 6, Risk 2)."""
from __future__ import annotations

import logging
import re

logger = logging.getLogger("devboard.sanitize")

PATTERNS = {
    "email": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "ipv4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "aws_credential": re.compile(r"AKIA[0-9A-Z]{16}|aws_secret_access_key\s*=\s*\S+"),
    "gcp_credential": re.compile(r'"type":\s*"service_account"'),
    "azure_credential": re.compile(r"AccountKey=[A-Za-z0-9+/=]{20,}"),
}


def sanitize_diff(diff_text: str) -> tuple[str, list[str]]:
    """Returns (sanitized_text, categories_stripped). Original content is never logged."""
    stripped_categories: list[str] = []
    sanitized = diff_text
    for category, pattern in PATTERNS.items():
        if pattern.search(sanitized):
            stripped_categories.append(category)
            sanitized = pattern.sub(f"[REDACTED:{category.upper()}]", sanitized)

    if stripped_categories:
        logger.info("stripped sensitive content categories before LLM call: %s", stripped_categories)

    return sanitized, stripped_categories
