#!/usr/bin/env bash
#
# Publish dist/ to the Cloudflare R2 bucket the site plays from.
#
#   ./upload.sh              everything in dist/
#   ./upload.sh brand m3-gear   just those slugs
#
# Needs CLOUDFLARE_API_TOKEN in the environment (see ~/.zshrc.local). The token
# is an R2 token with Admin Read & Write; object-level permission is not enough
# because it cannot set the bucket's CORS policy.
#
# Why R2 rather than GitHub Pages, which is where the site itself lives: the
# 1080p brand rendition is 76MB, and Pages is neither meant for files that size
# nor for video traffic. R2 charges nothing for egress, honours Range requests
# -- which this HLS ladder depends on, since each rendition is one file that
# players seek into by byte offset -- and serves from Cloudflare's edge.

set -euo pipefail
cd "$(dirname "$0")"

BUCKET="${BUCKET:-headroom-video}"
DIST="dist"

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "CLOUDFLARE_API_TOKEN is not set." >&2
  echo "Cloudflare dashboard -> R2 -> Manage API tokens -> Admin Read & Write." >&2
  exit 1
fi

if ! command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(npx --yes wrangler@latest)
else
  WRANGLER=(wrangler)
fi

# A slug argument narrows the upload to those directories; with none, everything.
if [ "$#" -gt 0 ]; then
  roots=()
  for slug in "$@"; do
    [ -d "$DIST/$slug" ] || { echo "no such video: $slug" >&2; exit 1; }
    roots+=("$DIST/$slug")
  done
else
  roots=("$DIST")
fi

ok=0
fail=0

while IFS= read -r file; do
  key="${file#$DIST/}"

  # Playlists get a short TTL so a re-cut ladder is picked up the same day.
  # Everything else is content that only ever changes by being replaced under a
  # new name, so it is cached for a year.
  case "$key" in
    *.m3u8) type="application/vnd.apple.mpegurl"; cache="public, max-age=300" ;;
    *.mp4)  type="video/mp4";  cache="public, max-age=31536000, immutable" ;;
    *.vtt)  type="text/vtt";   cache="public, max-age=31536000, immutable" ;;
    *.jpg)  type="image/jpeg"; cache="public, max-age=31536000, immutable" ;;
    *) continue ;;
  esac

  if "${WRANGLER[@]}" r2 object put "$BUCKET/$key" \
      --file "$file" --content-type "$type" --cache-control "$cache" \
      --remote >/dev/null 2>&1; then
    ok=$((ok + 1))
    printf "."
  else
    fail=$((fail + 1))
    printf "\nfailed: %s\n" "$key"
  fi
done < <(find "${roots[@]}" -type f \
  \( -name '*.m3u8' -o -name '*.mp4' -o -name '*.vtt' -o -name '*.jpg' \) | sort)

printf "\nuploaded %d, failed %d -> https://video.avand.fm/\n" "$ok" "$fail"
[ "$fail" -eq 0 ]
