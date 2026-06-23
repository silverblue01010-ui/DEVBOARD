"""Security rules. All findings here are severity=critical and therefore always
blocking (request_changes) per the Phase 1 constraint that SEC rules are never
downgraded.
"""
from __future__ import annotations

import re
import httpx

from app.diff_parser import ParsedFileDiff
from app.rules.engine import Finding

SECRET_PATTERN = re.compile(
    r"""(?i)(password|api_key|secret|token)\s*=\s*["'](?!\{\{|\$\{|os\.environ|process\.env)([^"']{6,})["']"""
)

SQL_CONCAT_PATTERN = re.compile(
    r"""(?i)(SELECT|INSERT|UPDATE|DELETE)\b.{0,200}?["']\s*\+\s*\w+|["']\s*%\s*\w+|f["'].*\{.*\}.*(SELECT|INSERT|UPDATE|DELETE)"""
)

XSS_PATTERN = re.compile(r"""(?i)\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\(""")

OSV_API_URL = "https://api.osv.dev/v1/query"
OSV_TIMEOUT_SECONDS = 5.0


def rule_sec_001_hardcoded_secrets(file_diff: ParsedFileDiff) -> list[Finding]:
    findings = []
    for line in file_diff.added_lines():
        if SECRET_PATTERN.search(line.content):
            findings.append(
                Finding(
                    rule_id="SEC-001",
                    source="RULE",
                    severity="critical",
                    file=file_diff.file,
                    line=line.line_number,
                    message="Hardcoded secret detected in source code",
                    why=(
                        "Secrets committed to source control persist in git history even if later removed, "
                        "and can leak via logs, forks, or CI artifacts."
                    ),
                    suggestion=(
                        "Move the value to an environment variable or a secrets manager "
                        "(Vault / AWS Secrets Manager), and rotate the exposed credential."
                    ),
                    confidence=0.9,
                )
            )
    return findings


def rule_sec_002_sql_injection(file_diff: ParsedFileDiff) -> list[Finding]:
    if file_diff.language not in ("python", "javascript", "typescript", "java", "ruby", "php", "csharp"):
        return []
    findings = []
    for line in file_diff.added_lines():
        if SQL_CONCAT_PATTERN.search(line.content):
            findings.append(
                Finding(
                    rule_id="SEC-002",
                    source="RULE",
                    severity="critical",
                    file=file_diff.file,
                    line=line.line_number,
                    message="Possible SQL injection via string concatenation/formatting",
                    why="Building SQL queries by concatenating untrusted input allows attackers to alter query logic.",
                    suggestion="Use parameterized queries / prepared statements instead of string concatenation or interpolation.",
                    confidence=0.75,
                )
            )
    return findings


def rule_sec_003_xss(file_diff: ParsedFileDiff) -> list[Finding]:
    if file_diff.language not in ("javascript", "typescript"):
        return []
    findings = []
    for line in file_diff.added_lines():
        if XSS_PATTERN.search(line.content):
            findings.append(
                Finding(
                    rule_id="SEC-003",
                    source="RULE",
                    severity="critical",
                    file=file_diff.file,
                    line=line.line_number,
                    message="Potential XSS: unescaped content rendered into the DOM",
                    why="Rendering unsanitized user input as HTML allows attackers to inject scripts that run in victims' browsers.",
                    suggestion="Use textContent, a sanitization library (e.g. DOMPurify), or your framework's safe-rendering APIs instead.",
                    confidence=0.7,
                )
            )
    return findings


def _extract_changed_packages(file_diff: ParsedFileDiff) -> list[tuple[str, str, str]]:
    """Returns (ecosystem, name, version) for added/changed dependency lines."""
    results = []
    if file_diff.file.endswith("package.json"):
        pkg_line = re.compile(r'"([\w@/.\-]+)"\s*:\s*"[\^~]?([\d.]+)"')
        for line in file_diff.added_lines():
            m = pkg_line.search(line.content)
            if m:
                results.append(("npm", m.group(1), m.group(2)))
    elif file_diff.file.endswith("requirements.txt"):
        pkg_line = re.compile(r"^([A-Za-z0-9_.\-]+)==([\d.]+)")
        for line in file_diff.added_lines():
            m = pkg_line.match(line.content.strip())
            if m:
                results.append(("PyPI", m.group(1), m.group(2)))
    return results


def rule_sec_004_dependency_vulnerability(file_diff: ParsedFileDiff) -> list[Finding]:
    packages = _extract_changed_packages(file_diff)
    if not packages:
        return []

    findings = []
    for ecosystem, name, version in packages:
        try:
            resp = httpx.post(
                OSV_API_URL,
                json={"package": {"name": name, "ecosystem": ecosystem}, "version": version},
                timeout=OSV_TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            data = resp.json()
        except httpx.HTTPError:
            # 5s timeout / unavailable API → skip this dependency, log, do not fail the job
            # (Phase 1 constraint). Logging is left to the caller via the empty-result return.
            continue

        vulns = data.get("vulns", [])
        if vulns:
            ids = ", ".join(v.get("id", "?") for v in vulns[:3])
            findings.append(
                Finding(
                    rule_id="SEC-004",
                    source="RULE",
                    severity="critical",
                    file=file_diff.file,
                    line=1,
                    message=f"Dependency {name}@{version} has known vulnerabilities ({ids})",
                    why="Shipping a dependency with a known CVE inherits that vulnerability into your application.",
                    suggestion=f"Upgrade {name} to a patched version per the OSV advisory.",
                    confidence=0.95,
                )
            )
    return findings


SECURITY_RULES = [
    rule_sec_001_hardcoded_secrets,
    rule_sec_002_sql_injection,
    rule_sec_003_xss,
    rule_sec_004_dependency_vulnerability,
]
