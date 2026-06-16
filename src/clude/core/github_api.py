from __future__ import annotations

import json
import re
import ssl
import urllib.request
import urllib.error
from typing import Any

from clude.core.health import RepoHealth

# GitHub names: alphanumeric, hyphens, underscores, dots. Max 100 chars.
# This prevents path traversal (e.g. "../") in constructed API URLs.
_GITHUB_NAME_RE = re.compile(r"^[a-zA-Z0-9._-]{1,100}$")

_SSL_CONTEXT = ssl.create_default_context()  # validates server cert


def _safe_name(value: str) -> str:
    """Return value if it is a valid GitHub name, raise ValueError otherwise."""
    if not _GITHUB_NAME_RE.match(value):
        raise ValueError(f"Invalid GitHub name: {value!r}")
    return value


def _get(path: str, token: str) -> Any | None:
    """Make an authenticated GET request to the GitHub API."""
    url = f"https://api.github.com{path}"
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github.v3+json")
    req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, context=_SSL_CONTEXT, timeout=10) as resp:
            return json.loads(resp.read())
    except (urllib.error.HTTPError, urllib.error.URLError, OSError, ValueError):
        return None


def enrich_with_github(health: RepoHealth, owner: str, token: str) -> None:
    """Fetch GitHub data for a repo and update the health object in-place."""
    try:
        safe_owner = _safe_name(owner)
        safe_repo = _safe_name(health.name)
    except ValueError:
        return

    repo_data = _get(f"/repos/{safe_owner}/{safe_repo}", token)
    if not isinstance(repo_data, dict):
        return

    # open_issues_count from GitHub includes PRs - we correct below
    raw_issues = repo_data.get("open_issues_count", 0)

    prs_data = _get(f"/repos/{safe_owner}/{safe_repo}/pulls?state=open&per_page=100", token)
    if isinstance(prs_data, list):
        health.open_prs = len(prs_data)
        health.open_issues = max(0, raw_issues - health.open_prs)
    else:
        health.open_issues = raw_issues

    runs_data = _get(f"/repos/{safe_owner}/{safe_repo}/actions/runs?per_page=1", token)
    if isinstance(runs_data, dict):
        runs = runs_data.get("workflow_runs", [])
        if runs:
            conclusion = runs[0].get("conclusion")
            if conclusion == "success":
                health.last_ci_status = "passing"
            elif conclusion in ("failure", "cancelled", "timed_out"):
                health.last_ci_status = "failing"
            else:
                health.last_ci_status = "unknown"
