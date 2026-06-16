from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import click

from clude.core.git_ops import Commit, find_repos, get_commits_since, get_git_author_email
from clude.utils.console import console


@click.group()
def log() -> None:
    """View git activity across all repositories."""


def _gather(path: Path, since: str, author: str | None) -> dict[str, list[Commit]]:
    repos = find_repos(path)
    by_repo: dict[str, list[Commit]] = {}
    with console.status("Gathering commits...") as status:
        for repo in repos:
            status.update(f"[dim]Reading[/dim] [bold]{repo.name}[/bold]...")
            commits = get_commits_since(repo, since, author)
            if commits:
                by_repo[repo.name] = commits
    return by_repo


def _print_summary(by_repo: dict[str, list[Commit]], heading: str) -> None:
    total = sum(len(v) for v in by_repo.values())
    if not by_repo:
        console.print("[yellow]No commits found.[/yellow]")
        return

    console.print(
        f"\n[bold]{heading}[/bold]  "
        f"[dim]{total} commit(s) across {len(by_repo)} repo(s)[/dim]\n"
    )

    for repo_name in sorted(by_repo):
        commits = sorted(by_repo[repo_name], key=lambda c: c.date)
        count = len(commits)
        console.print(
            f"[cyan bold]{repo_name}[/cyan bold] "
            f"[dim]({count} commit{'s' if count != 1 else ''})[/dim]"
        )
        for c in commits:
            day = f"{c.date.strftime('%a %b')} {c.date.day}"
            console.print(f"  [dim]{day:<12}[/dim] [yellow]{c.hash}[/yellow]  {c.message}")
        console.print()


@log.command()
@click.argument("path", default=".", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--author", help="Filter by author email (default: git config user.email).")
def today(path: Path, author: str | None) -> None:
    """Show today's commits across all repositories."""
    if author is None:
        author = get_git_author_email()
    since = datetime.now().strftime("%Y-%m-%d")
    by_repo = _gather(path, since, author)
    now = datetime.now()
    _print_summary(by_repo, f"Today  {now.strftime('%B')} {now.day}, {now.year}")


@log.command()
@click.argument("path", default=".", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("--author", help="Filter by author email (default: git config user.email).")
def week(path: Path, author: str | None) -> None:
    """Show the past 7 days of commits across all repositories."""
    if author is None:
        author = get_git_author_email()
    since = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
    by_repo = _gather(path, since, author)
    now = datetime.now()
    _print_summary(by_repo, f"Past 7 Days  ending {now.strftime('%B')} {now.day}")


@log.command()
@click.argument("path", default=".", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option(
    "--since",
    default="30 days ago",
    show_default=True,
    help="Start date or relative expression (e.g. '2024-01-01', '30 days ago').",
)
@click.option("--output", default="activity.md", show_default=True, help="Output file.")
@click.option("--author", help="Filter by author email (default: git config user.email).")
def export(path: Path, since: str, output: str, author: str | None) -> None:
    """Export git activity to a markdown file."""
    if author is None:
        author = get_git_author_email()

    by_repo = _gather(path, since, author)
    out_path = Path(output) if Path(output).is_absolute() else Path.cwd() / output
    total = sum(len(v) for v in by_repo.values())

    lines: list[str] = [
        "# Git Activity Report",
        "",
        f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Since: {since}",
        f"Total: {total} commit(s) across {len(by_repo)} repository(s)",
        "",
    ]

    for repo_name in sorted(by_repo):
        commits = sorted(by_repo[repo_name], key=lambda c: c.date)
        count = len(commits)
        lines.append(f"## {repo_name} ({count} commit{'s' if count != 1 else ''})")
        lines.append("")
        for c in commits:
            date_str = c.date.strftime("%Y-%m-%d")
            lines.append(f"- `{c.hash}` {date_str} {c.message}")
        lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    console.print(
        f"[green]ok[/green]  {total} commit(s) exported to [cyan]{out_path}[/cyan]"
    )
