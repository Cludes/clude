from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class Commit:
    repo: str
    hash: str
    author: str
    date: datetime
    message: str


def find_repos(root: Path) -> list[Path]:
    """Return git repos found as immediate subdirs of root, or root itself."""
    repos: list[Path] = []
    try:
        for item in sorted(root.iterdir()):
            if item.is_dir() and (item / ".git").exists():
                repos.append(item)
    except PermissionError:
        pass
    # Fallback: if no child repos found, check if root itself is a repo
    if not repos and (root / ".git").exists():
        repos = [root]
    return repos


def _run_git(*args: str, cwd: Path) -> str:
    """Run a git command and return stdout, or empty string on failure."""
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result.stdout if result.returncode == 0 else ""
    except Exception:
        return ""


def get_commits_since(
    repo_path: Path,
    since: str,
    author_email: str | None = None,
) -> list[Commit]:
    """Return commits from repo_path since the given date/expression."""
    output = _run_git(
        "log",
        f"--since={since}",
        "--format=%H|%ae|%ai|%s",
        "--all",
        cwd=repo_path,
    )
    commits: list[Commit] = []
    for line in output.splitlines():
        parts = line.split("|", 3)
        if len(parts) < 4:
            continue
        hash_, email, date_str, message = parts
        if author_email and email.lower() != author_email.lower():
            continue
        try:
            date = datetime.strptime(date_str[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            date = datetime.now()
        commits.append(
            Commit(
                repo=repo_path.name,
                hash=hash_[:7],
                author=email,
                date=date,
                message=message.strip(),
            )
        )
    return commits


def get_git_author_email() -> str | None:
    """Return the global git user.email, or None if not configured."""
    try:
        result = subprocess.run(
            ["git", "config", "--global", "user.email"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:
        return None
