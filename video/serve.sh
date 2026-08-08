#!/usr/bin/env bash
#
# Preview the Headroom site locally, or from a phone or a tunnel.
#
#   ./serve.sh          then open http://localhost:8100/headroom/
#
# See preview.py for what it serves and why there are two ports.

set -euo pipefail
cd "$(dirname "$0")"
exec python3 preview.py "${SITE_PORT:-8100}" "${VIDEO_PORT:-8101}"
