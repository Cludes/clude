from __future__ import annotations

from pathlib import Path


def parse_dotenv(path: Path) -> dict[str, str]:
    """Parse a .env file into a {KEY: VALUE} dict.

    Handles:
    - KEY=VALUE
    - KEY="VALUE" / KEY='VALUE'
    - export KEY=VALUE
    - # comments and blank lines
    """
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].strip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        if key:
            result[key] = value
    return result
