#!/usr/bin/env bash
#
# PreToolUse guard for file-writing tools.
#
# Reads the hook event JSON from STDIN, extracts the target file path from the
# tool input, and exits 2 (deny) when that path is inside data/private/ or is a
# dotenv file (.env or .env.*) OTHER than .env.example. Any other path is
# allowed (exit 0).
#
# PreToolUse fails closed: if this script cannot deliver a verdict it should not
# silently allow a sensitive write. We therefore deny (exit 2) when a path is
# present and matches, and otherwise allow. Parsing errors with no extractable
# path allow the call (there is nothing to block), matching "block only the
# sensitive paths" intent while keeping normal writes working.

set -euo pipefail

event="$(cat)"

# Extract the target path from the event JSON using Node (already a project
# dependency). We look at the common tool-input path fields in order.
target="$(
  printf '%s' "$event" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let path = "";
      try {
        const e = JSON.parse(raw || "{}");
        const ti = e.tool_input || e.toolInput || {};
        path =
          ti.path ||
          ti.file_path ||
          ti.filePath ||
          ti.target ||
          ti.file ||
          e.path ||
          e.file_path ||
          "";
      } catch {
        path = "";
      }
      process.stdout.write(String(path || ""));
    });
  ' 2>/dev/null || true
)"

# No path to inspect -> nothing sensitive to block.
if [ -z "$target" ]; then
  exit 0
fi

# Normalize to a repo-relative path: strip a leading cwd prefix and any leading
# "./" so the pattern checks below work on both absolute and relative inputs.
rel="$target"
rel="${rel#"$PWD"/}"
rel="${rel#./}"

# The final path segment, for matching .env filenames regardless of directory.
base="$(basename "$rel")"

deny() {
  echo "block-private-data: refusing to write protected path: $target" >&2
  exit 2
}

# 1. Anything inside data/private/ (at the repo root or nested) is protected.
case "$rel" in
  data/private/*|*/data/private/*) deny ;;
esac

# 2. Dotenv files: .env and .env.* are protected, EXCEPT .env.example.
if [ "$base" = ".env.example" ]; then
  exit 0
fi
case "$base" in
  .env|.env.*) deny ;;
esac

exit 0
