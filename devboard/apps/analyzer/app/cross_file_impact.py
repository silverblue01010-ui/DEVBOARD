"""Builds a lightweight dependency graph: which files in the repo import/require
a changed file, so the PR summary can say "Changes to X may affect Y, Z".
Informational only — never blocking, never one comment per dependent (Phase 2 constraint).
"""
from __future__ import annotations

import re

IMPORT_PATTERNS = [
    re.compile(r"""(?:from|import)\s+['"](\.{1,2}/[\w/.\-]+)['"]"""),  # JS/TS relative imports
    re.compile(r"""require\(['"](\.{1,2}/[\w/.\-]+)['"]\)"""),  # CJS require
    re.compile(r"""from\s+([\w.]+)\s+import"""),  # Python "from x.y import z"
    re.compile(r"""^import\s+([\w.]+)""", re.MULTILINE),  # Python "import x.y"
]


def _module_name(path: str) -> str:
    """Normalizes a file path to a bare module name for fuzzy import matching."""
    name = path.rsplit("/", 1)[-1]
    for ext in (".ts", ".tsx", ".js", ".jsx", ".py"):
        if name.endswith(ext):
            name = name[: -len(ext)]
    return name


def find_dependents(changed_file: str, all_repo_files: dict[str, str]) -> list[str]:
    """all_repo_files: {path: full_file_content}. Returns paths of files that
    import/require changed_file, based on simple textual pattern matching
    (not a full AST resolver — sufficient for an informational "may affect" hint)."""
    target_module = _module_name(changed_file)
    dependents = []

    for path, content in all_repo_files.items():
        if path == changed_file:
            continue
        for pattern in IMPORT_PATTERNS:
            for match in pattern.finditer(content):
                imported = match.group(1)
                if target_module and target_module in imported:
                    dependents.append(path)
                    break
            else:
                continue
            break

    return dependents


def build_impact_summary(changed_files: list[str], all_repo_files: dict[str, str]) -> dict[str, list[str]]:
    return {f: find_dependents(f, all_repo_files) for f in changed_files if find_dependents(f, all_repo_files)}
