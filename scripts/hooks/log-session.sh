#!/usr/bin/env bash
#
# Stop-hook session logger.
#
# Appends one line to KIRO_LOG.md capturing, tab-separated:
#   <ISO-8601 UTC timestamp>  <current git branch>  <last line of git diff --stat HEAD>
#
# The diff summary line is the "N files changed, ... insertions(+), ... deletions(-)"
# footer that `git diff --stat` prints last. When there are no changes that
# footer is empty, so we record "no changes" instead.

set -euo pipefail

# Resolve the repo root so the hook writes the right KIRO_LOG.md regardless of
# the cwd the hook runs in. Fall back to cwd if this is somehow not a repo.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
log_file="$repo_root/KIRO_LOG.md"

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"

# Last line of the diff stat (the summary footer). Empty when nothing changed.
diff_stat_last="$(git -C "$repo_root" diff --stat HEAD 2>/dev/null | tail -n 1 || true)"
# Trim leading/trailing whitespace that `--stat` indents the footer with.
diff_stat_last="$(printf '%s' "$diff_stat_last" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
if [ -z "$diff_stat_last" ]; then
  diff_stat_last="no changes"
fi

printf '%s\t%s\t%s\n' "$timestamp" "$branch" "$diff_stat_last" >> "$log_file"
