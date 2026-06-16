from __future__ import annotations

from datetime import datetime

from rich.console import Console

console = Console()


def relative_time(dt: datetime | None) -> str:
    """Format a datetime as a human-readable relative string."""
    if dt is None:
        return "[dim]never[/dim]"
    now = datetime.now()
    normalized = dt.replace(tzinfo=None) if dt.tzinfo is not None else dt
    diff = now - normalized
    days = diff.days
    if days < 0:
        return "just now"
    if days == 0:
        hours = diff.seconds // 3600
        if hours == 0:
            minutes = diff.seconds // 60
            return f"{minutes}m ago" if minutes > 0 else "just now"
        return f"{hours}h ago"
    if days == 1:
        return "yesterday"
    if days < 7:
        return f"{days}d ago"
    if days < 30:
        return f"{days // 7}w ago"
    if days < 365:
        return f"{days // 30}mo ago"
    return f"{days // 365}y ago"
