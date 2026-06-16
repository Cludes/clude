from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class EnvVarUsage:
    name: str
    file: str
    line: int


_PATTERNS: dict[str, list[str]] = {
    ".js":  [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".ts":  [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".jsx": [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".tsx": [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".mjs": [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".cjs": [r"process\.env\.([A-Za-z_]\w*)", r"process\.env\[['\"]([A-Za-z_]\w*)['\"]\]"],
    ".py":  [
        r"os\.environ\[['\"]([A-Za-z_]\w*)['\"]\]",
        r"os\.getenv\(['\"]([A-Za-z_]\w*)['\"]",
        r"environ\.get\(['\"]([A-Za-z_]\w*)['\"]",
    ],
    ".go":  [r'os\.Getenv\("([A-Za-z_]\w*)"\)'],
    ".rb":  [r"ENV\[['\"]([A-Za-z_]\w*)['\"]\]", r"ENV\.fetch\(['\"]([A-Za-z_]\w*)['\"]"],
    ".rs":  [r'env::var\("([A-Za-z_]\w*)"\)', r'std::env::var\("([A-Za-z_]\w*)"\)'],
}

_SKIP_DIRS: frozenset[str] = frozenset({
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", "target", ".cache", ".turbo",
})

_COMPILED: dict[str, list[re.Pattern[str]]] = {
    ext: [re.compile(p) for p in patterns]
    for ext, patterns in _PATTERNS.items()
}


def scan_directory(root: Path) -> list[EnvVarUsage]:
    """Scan all source files under root for environment variable usage."""
    results: list[EnvVarUsage] = []

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in _SKIP_DIRS for part in path.parts):
            continue
        patterns = _COMPILED.get(path.suffix)
        if patterns is None:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        rel = path.relative_to(root)
        for pattern in patterns:
            for match in pattern.finditer(text):
                line = text[: match.start()].count("\n") + 1
                results.append(EnvVarUsage(name=match.group(1), file=str(rel), line=line))

    return results
