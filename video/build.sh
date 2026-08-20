#!/usr/bin/env bash
#
# Transcode every Headroom video into its HLS ladder.
#
# Sources are the camera masters in src/ (~2.1GB, gitignored -- they are the
# originals, and everything else here is derived from them). Point SOURCES
# elsewhere if they live on another disk.
#
# Poster timestamps are chosen by hand: the module videos open on a ~5s title
# animation and close on an end card, so a poster has to be pulled from the
# title card in between.

set -euo pipefail
cd "$(dirname "$0")"

SOURCES=${SOURCES:-"src"}

# slug|poster-seconds|path
VIDEOS=(
  "brand|33|$SOURCES/Brand Hero Video/HEADROOM_BrandHero_V2.mp4"
  "m1-sound|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module1_Sound_V4.mp4"
  "m2-signal-flow|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module2_Signal Flow_V2.mp4"
  "m3-gear|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module3_Gear_V2.mp4"
  "m4-tracks|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module4_Tracks_V2.mp4"
  "m5-library|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module5_Library_V2.mp4"
  "m6-playing|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module6_Playing_V2.mp4"
  "m7-attunement|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module7_Attunement_V2.mp4"
  "m8-showtime|4.3|$SOURCES/Module Videos/AVAND_HEADROOM_Module8_Showtime_V2.mp4"
  "bloopers|130.3|$SOURCES/Blooper Reel/Blooper Reel.mp4"
)

for entry in "${VIDEOS[@]}"; do
  IFS='|' read -r slug poster src <<<"$entry"
  if [ ! -f "$src" ]; then
    echo "!!  missing source for $slug: $src" >&2
    exit 1
  fi
  ./transcode.sh "$src" "$slug" "$poster"
done

echo
echo "total: $(du -sh dist | cut -f1)"
