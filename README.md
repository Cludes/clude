# clude

Developer workspace CLI - audit env vars across every language, health-check every git repo in a directory, and review your git activity across all your projects at once.

[![PyPI](https://img.shields.io/pypi/v/clude.svg)](https://pypi.org/project/clude/)
[![Python](https://img.shields.io/pypi/pyversions/clude.svg)](https://pypi.org/project/clude/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Try it in your browser, no install needed: **[clude-cli.pages.dev](https://clude-cli.pages.dev)**

## Install

```bash
pip install clude

# optional: isolated install that's always on PATH
pipx install clude
```

Requires Python 3.10+. Works on Windows, macOS, and Linux.

Run it as `clude` - or as `python -m clude` if your shell can't find the command (works anywhere, no PATH setup). On Windows `cmd.exe`, pass a full path like `%USERPROFILE%\Documents`, since `cmd` doesn't expand `~` (PowerShell, macOS, and Linux do).

## Commands

### `env` - environment variable auditing

Static analysis across JavaScript, TypeScript, Python, Go, Ruby, and Rust.

```bash
clude env scan ./my-project       # find every env var your code references
clude env validate ./my-project   # diff your .env against discovered vars
clude env generate ./my-project   # write a .env.example automatically
```

### `fleet` - multi-repo health

Scan every git repo under a directory: last commit, uncommitted changes, ahead/behind remote, and stale branches.

```bash
clude fleet audit ~/Documents     # health dashboard for all repos
clude fleet report ~/Documents    # export the report to markdown
```

Add `--github-user yourname` (with `GITHUB_TOKEN` set in your environment) to enrich the table with open PRs, issues, and CI status.

### `log` - git activity

```bash
clude log today ~/Documents       # today's commits across all repos
clude log week ~/Documents        # the past 7 days
clude log export ~/Documents      # write activity to a markdown file
```

Commits are filtered to your git author email by default; override with `--author someone@example.com`.

## In-browser demo

The hosted terminal at [clude-cli.pages.dev](https://clude-cli.pages.dev) runs `fleet audit`, `log`, and `env scan` against any public GitHub account, right in the browser - a quick way to try clude before installing.

## Development

```bash
git clone https://github.com/Cludes/clude
cd clude
pip install -e .
python -m clude --help
```

## License

MIT
