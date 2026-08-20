#!/usr/bin/env bash
#
# Warn when a versioned asset changes without its cache-bust version moving.
#
# Assets here are served at URLs that never change: GitHub Pages caches them for
# ten minutes, and R2 caches captions for a year. Nothing errors when the
# version is not bumped -- the edit simply reaches nobody, including whoever
# made it. That is the whole reason this exists: it is the one rule in the repo
# whose failure is completely silent.
#
# Reads a PostToolUse payload on stdin, warns on stderr, exits 2 so the warning
# is fed back rather than swallowed. Exit 0 (silent) for anything else.

set -uo pipefail

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_response.filePath // .tool_input.file_path // empty' 2>/dev/null)
[ -n "$file" ] || exit 0

repo=$(git -C "$(dirname "$file")" rev-parse --show-toplevel 2>/dev/null) || exit 0
rel=${file#"$repo"/}

# asset -> the file holding its version, and the pattern that version lives in
case "$rel" in
  headroom/headroom.css)          holder="_layouts/headroom.html"; pattern='headroom\.css\?v=[0-9]+' ;;
  headroom/index.css)             holder="_layouts/headroom.html"; pattern='index\.css\?v=[0-9]+' ;;
  headroom/concepts/concepts.css) holder="_layouts/headroom.html"; pattern='concepts\.css\?v=[0-9]+' ;;
  video/dist/*/captions.vtt)      holder="headroom/player.js";     pattern='CAPTIONS_V = [0-9]+' ;;
  headroom/hls.min.js)            exit 0 ;;  # vendored, loaded by name from player.js
  headroom/*.js)                  holder="headroom/index.html";    pattern='\?v=[0-9]+' ;;
  *)                              exit 0 ;;
esac

# Only complain about a real change. An asset identical to HEAD needs nothing.
git -C "$repo" diff --quiet HEAD -- "$rel" 2>/dev/null && exit 0

current=$(grep -Eo "$pattern" "$repo/$holder" 2>/dev/null | head -1)
committed=$(git -C "$repo" show "HEAD:$holder" 2>/dev/null | grep -Eo "$pattern" | head -1)

# Version already moved, or the holder is new/unreadable -- nothing to say.
[ -n "$current" ] || exit 0
[ "$current" != "$committed" ] && exit 0

cat >&2 <<EOF
$rel changed, but its cache-bust version has not moved.

  $holder still has: $current

That file is served at a fixed URL and cached (ten minutes on GitHub Pages, a
year for captions on R2), so without a bump this edit reaches nobody -- and
nothing will error to tell you. Bump it in this same commit.
EOF
exit 2
