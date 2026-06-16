from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

import click
from rich import box
from rich.table import Table

from clude.core.git_ops import find_repos
from clude.core.github_api import enrich_with_github
from clude.core.health import RepoHealth, check_repo_health
from clude.utils.console import console, relative_time


@click.group()
def fleet() -> None:
    """Manage and audit multiple repositories."""


def _collect(path: Path, github_user: str | None) -> list[RepoHealth]:
    repos = find_repos(path)
    if not repos:
        return []

    results: list[RepoHealth] = []
    with console.status("Checking repositories...") as status:
        for repo in repos:
            status.update(f"[dim]Checking[/dim] [bold]{repo.name}[/bold]...")
            results.append(check_repo_health(repo))

    token = os.environ.get("GITHUB_TOKEN")
    if token and len(token) > 512:
        # Reject suspiciously long values to prevent header injection
        token = None
    if github_user and token:
        with console.status("Fetching GitHub data...") as status:
            for health in results:
                status.update(f"[dim]GitHub:[/dim] [bold]{health.name}[/bold]...")
                enrich_with_github(health, github_user, token)
    elif github_user:
        console.print("[yellow]GITHUB_TOKEN not set - skipping remote enrichment.[/yellow]")

    return results


def _build_table(results: list[RepoHealth], title: str) -> Table:
    has_gh = any(r.open_prs is not None for r in results)

    table = Table(title=title, box=box.ROUNDED, show_lines=False)
    table.add_column("Repository", style="cyan bold", no_wrap=True)
    table.add_column("Last Commit", justify="right")
    table.add_column("Changes", justify="center")
    table.add_column("Sync", justify="center")
    table.add_column("Stale Branches", justify="center")
    if has_gh:
        table.add_column("PRs", justify="center")
        table.add_column("Issues", justify="center")
        table.add_column("CI", justify="center")

    for r in results:
        last = relative_time(r.last_commit)
        changes = (
            "[green]clean[/green]"
            if r.uncommitted_changes == 0
            else f"[yellow]{r.uncommitted_changes}[/yellow]"
        )

        ahead, behind = r.ahead_behind
        if not r.has_remote:
            sync = "[dim]local[/dim]"
        elif ahead == 0 and behind == 0:
            sync = "[green]synced[/green]"
        else:
            parts = []
            if ahead:
                parts.append(f"[blue]+{ahead}[/blue]")
            if behind:
                parts.append(f"[red]-{behind}[/red]")
            sync = " ".join(parts)

        stale_count = len(r.stale_branches)
        stale = "[green]0[/green]" if stale_count == 0 else f"[yellow]{stale_count}[/yellow]"

        row: list[str] = [r.name, last, changes, sync, stale]
        if has_gh:
            prs = str(r.open_prs) if r.open_prs is not None else "[dim]-[/dim]"
            issues = str(r.open_issues) if r.open_issues is not None else "[dim]-[/dim]"
            ci_map = {"passing": "[green]ok[/green]", "failing": "[red]fail[/red]"}
            ci = ci_map.get(r.last_ci_status or "", "[dim]-[/dim]")
            row.extend([prs, issues, ci])

        table.add_row(*row)

    return table


@fleet.command()
@click.argument("path", default=".", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--github-user", envvar="GITHUB_USER", help="GitHub username for remote data.")
def audit(path: Path, github_user: str | None) -> None:
    """Show health status for all repositories in PATH."""
    results = _collect(path, github_user)

    if not results:
        console.print(f"[yellow]No git repositories found in {path}[/yellow]")
        return

    table = _build_table(results, f"Fleet Audit  {path}")
    console.print(table)
    console.print(f"\n[dim]{len(results)} repositories scanned.[/dim]")


@fleet.command()
@click.argument("path", default=".", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--output", default="fleet-report.md", show_default=True, help="Output file.")
@click.option("--github-user", envvar="GITHUB_USER", help="GitHub username for remote data.")
def report(path: Path, output: str, github_user: str | None) -> None:
    """Write a fleet health report to a markdown file."""
    results = _collect(path, github_user)

    if not results:
        console.print(f"[yellow]No git repositories found in {path}[/yellow]")
        return

    out_path = Path(output) if Path(output).is_absolute() else Path.cwd() / output
    has_gh = any(r.open_prs is not None for r in results)

    header = "| Repository | Last Commit | Changes | Sync | Stale Branches |"
    divider = "|---|---|---|---|---|"
    if has_gh:
        header += " PRs | Issues | CI |"
        divider += "---|---|---|"

    rows: list[str] = []
    for r in results:
        last = relative_time(r.last_commit)
        changes = str(r.uncommitted_changes) if r.uncommitted_changes else "clean"
        ahead, behind = r.ahead_behind
        sync = f"+{ahead}/-{behind}" if r.has_remote else "local"
        stale = str(len(r.stale_branches))
        row = f"| {r.name} | {last} | {changes} | {sync} | {stale} |"
        if has_gh:
            prs = str(r.open_prs) if r.open_prs is not None else "-"
            issues = str(r.open_issues) if r.open_issues is not None else "-"
            ci = r.last_ci_status or "-"
            row += f" {prs} | {issues} | {ci} |"
        rows.append(row)

    content = "\n".join([
        "# Fleet Report",
        "",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Path: `{path}`",
        f"Repositories: {len(results)}",
        "",
        header,
        divider,
        *rows,
        "",
    ])

    out_path.write_text(content, encoding="utf-8")
    console.print(f"[green]ok[/green]  Report written to [cyan]{out_path}[/cyan]")
