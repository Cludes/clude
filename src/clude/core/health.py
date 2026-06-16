from __future__ import annotations

import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


@dataclass
class RepoHealth:
    name: str
    path: str
    last_commit: datetime | None
    uncommitted_changes: int
    stale_branches: list[str]
    ahead_behind: tuple[int, int]
    has_remote: bool
    remote_url: str | None
    open_prs: int | None = None
    open_issues: int | None = None
    last_ci_status: str | None = None


def _git(repo: Path, *args: str) -> str:
    try:
        r = subprocess.run(
            ["git", *args],
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=10,
        )
        return r.stdout if r.returncode == 0 else ""
    except Exception:
        return ""


_TRUNK_BRANCHES: frozenset[str] = frozenset({"main", "master", "develop", "dev", "trunk"})


def check_repo_health(repo: Path) -> RepoHealth:
    # Last commit datetime
    last_commit: datetime | None = None
    raw = _git(repo, "log", "-1", "--format=%ai").strip()
    if raw:
        try:
            last_commit = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            pass

    # Uncommitted changes
    status_output = _git(repo, "status", "--porcelain")
    uncommitted = len([ln for ln in status_output.splitlines() if ln.strip()])

    # Remote URL
    remote_url: str | None = _git(repo, "remote", "get-url", "origin").strip() or None
    has_remote = remote_url is not None

    # Ahead / behind vs upstream
    ahead_behind: tuple[int, int] = (0, 0)
    if has_remote:
        raw_ab = _git(repo, "rev-list", "--left-right", "--count", "HEAD...@{upstream}")
        if raw_ab.strip():
            parts = raw_ab.strip().split()
            if len(parts) == 2:
                try:
                    ahead_behind = (int(parts[0]), int(parts[1]))
                except ValueError:
                    pass

    # Stale branches (no activity in 30+ days, excluding trunk branches)
    stale_branches: list[str] = []
    refs_output = _git(
        repo,
        "for-each-ref",
        "--format=%(refname:short)|%(committerdate:iso)",
        "refs/heads/",
    )
    now = datetime.now()
    for line in refs_output.splitlines():
        parts = line.split("|", 1)
        if len(parts) < 2:
            continue
        branch, date_str = parts
        if branch in _TRUNK_BRANCHES:
            continue
        try:
            branch_date = datetime.strptime(date_str.strip()[:19], "%Y-%m-%d %H:%M:%S")
            if (now - branch_date).days > 30:
                stale_branches.append(branch)
        except ValueError:
            continue

    return RepoHealth(
        name=repo.name,
        path=str(repo),
        last_commit=last_commit,
        uncommitted_changes=uncommitted,
        stale_branches=stale_branches,
        ahead_behind=ahead_behind,
        has_remote=has_remote,
        remote_url=remote_url,
    )
