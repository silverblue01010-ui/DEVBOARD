"""Parses a raw unified diff (as returned by GitHub's diff media type) into a
structured format: one entry per file, each with hunks of typed lines.

Only added lines are passed to the rule engine — we review what changed, not
what was deleted (Phase 1 constraint).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

EXT_TO_LANGUAGE = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".go": "go",
    ".java": "java",
    ".rb": "ruby",
    ".php": "php",
    ".rs": "rust",
    ".c": "c",
    ".cpp": "cpp",
    ".cs": "csharp",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".md": "markdown",
}

FILE_HEADER_RE = re.compile(r"^diff --git a/(.+) b/(.+)$")
HUNK_HEADER_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")


@dataclass
class DiffLine:
    type: str  # "add" | "remove" | "context"
    content: str
    line_number: int


@dataclass
class DiffHunk:
    old_start: int
    new_start: int
    lines: list[DiffLine] = field(default_factory=list)


@dataclass
class ParsedFileDiff:
    file: str
    language: str
    hunks: list[DiffHunk] = field(default_factory=list)

    def added_lines(self) -> list[DiffLine]:
        return [line for hunk in self.hunks for line in hunk.lines if line.type == "add"]


def detect_language(filename: str) -> str:
    for ext, lang in EXT_TO_LANGUAGE.items():
        if filename.endswith(ext):
            return lang
    return "unknown"


def parse_unified_diff(raw_diff: str) -> list[ParsedFileDiff]:
    files: list[ParsedFileDiff] = []
    current_file: ParsedFileDiff | None = None
    current_hunk: DiffHunk | None = None
    new_line_no = 0
    old_line_no = 0

    for line in raw_diff.splitlines():
        file_match = FILE_HEADER_RE.match(line)
        if file_match:
            filename = file_match.group(2)
            current_file = ParsedFileDiff(file=filename, language=detect_language(filename))
            files.append(current_file)
            current_hunk = None
            continue

        if current_file is None:
            continue  # skip preamble (index lines, mode changes, etc.)

        hunk_match = HUNK_HEADER_RE.match(line)
        if hunk_match:
            old_line_no = int(hunk_match.group(1))
            new_line_no = int(hunk_match.group(2))
            current_hunk = DiffHunk(old_start=old_line_no, new_start=new_line_no)
            current_file.hunks.append(current_hunk)
            continue

        if current_hunk is None:
            continue

        if line.startswith("+") and not line.startswith("+++"):
            current_hunk.lines.append(DiffLine(type="add", content=line[1:], line_number=new_line_no))
            new_line_no += 1
        elif line.startswith("-") and not line.startswith("---"):
            current_hunk.lines.append(DiffLine(type="remove", content=line[1:], line_number=old_line_no))
            old_line_no += 1
        elif line.startswith(" "):
            current_hunk.lines.append(DiffLine(type="context", content=line[1:], line_number=new_line_no))
            new_line_no += 1
            old_line_no += 1
        # lines like "\ No newline at end of file" are ignored

    return files


def to_dict(files: list[ParsedFileDiff]) -> list[dict]:
    """JSON-serializable form, matching the shared TS ParsedFileDiff contract."""
    return [
        {
            "file": f.file,
            "language": f.language,
            "hunks": [
                {
                    "oldStart": h.old_start,
                    "newStart": h.new_start,
                    "lines": [
                        {"type": ln.type, "content": ln.content, "lineNumber": ln.line_number} for ln in h.lines
                    ],
                }
                for h in f.hunks
            ],
        }
        for f in files
    ]
