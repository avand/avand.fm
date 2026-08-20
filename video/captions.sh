#!/usr/bin/env bash
#
# Generate WebVTT captions for every video.
#
#   ./captions.sh
#
# Muted autoplay is silent video, so captions are the only way the brand hero
# and the module clips say anything until someone turns sound on. They also make
# the videos usable for deaf and hard-of-hearing visitors, and searchable.
#
# Output lands next to each video's renditions as captions.vtt. Whisper is very
# good but not perfect with proper nouns -- rekordbox, CDJ, AlphaTheta, Mixed In
# Key -- so FIXUPS below rewrites the ones it reliably gets wrong, and the
# results are still worth reading before they ship.

set -euo pipefail
cd "$(dirname "$0")"

MODEL_DIR="${MODEL_DIR:-$HOME/.cache/whisper-cpp}"
MODEL="$MODEL_DIR/ggml-small.en.bin"
SOURCES=${SOURCES:-"src"}

if [ ! -f "$MODEL" ]; then
  echo "==> downloading whisper small.en model (~466MB, once)"
  mkdir -p "$MODEL_DIR"
  curl -sSL --fail -o "$MODEL" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"
fi

# slug|path
VIDEOS=(
  "brand|$SOURCES/Brand Hero Video/HEADROOM_BrandHero_V2.mp4"
  "m1-sound|$SOURCES/Module Videos/AVAND_HEADROOM_Module1_Sound_V4.mp4"
  "m2-signal-flow|$SOURCES/Module Videos/AVAND_HEADROOM_Module2_Signal Flow_V2.mp4"
  "m3-gear|$SOURCES/Module Videos/AVAND_HEADROOM_Module3_Gear_V2.mp4"
  "m4-tracks|$SOURCES/Module Videos/AVAND_HEADROOM_Module4_Tracks_V2.mp4"
  "m5-library|$SOURCES/Module Videos/AVAND_HEADROOM_Module5_Library_V2.mp4"
  "m6-playing|$SOURCES/Module Videos/AVAND_HEADROOM_Module6_Playing_V2.mp4"
  "m7-attunement|$SOURCES/Module Videos/AVAND_HEADROOM_Module7_Attunement_V2.mp4"
  "m8-showtime|$SOURCES/Module Videos/AVAND_HEADROOM_Module8_Showtime_V2.mp4"
  "bloopers|$SOURCES/Blooper Reel/Blooper Reel.mp4"
)

# Terms Whisper mishears. These run through perl rather than sed: BSD sed reads
# basic regular expressions, where `?` is a literal character and `\b` means
# nothing, so these patterns silently matched nothing under it.
FIXUPS=(
  's/\b[Rr]ecord ?[Bb]ox\b/rekordbox/g'
  's/\b[Rr]ekord ?[Bb]ox\b/rekordbox/g'
  's/\bCD ?Js\b/CDJs/g'
  's/\bCD ?J\b/CDJ/g'
  's/\b[Aa]lpha ?[Tt]heta\b/AlphaTheta/g'
  's/\b[Mm]ixed [Ii]n [Kk]ey\b/Mixed In Key/g'
  's/\b[Pp]latinum [Nn]otes\b/Platinum Notes/g'
  's/\bEQing\b/EQ\x27ing/g'
  's/\b[Dd][Jj]ing\b/DJing/g'
  's/\b[Bb]eat ?[Gg]rids\b/beatgrids/g'
  's/\b[Bb]eat ?[Gg]rid\b/beatgrid/g'
  's/\b[Hh]ead ?room\b/Headroom/g'
)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

for entry in "${VIDEOS[@]}"; do
  IFS='|' read -r slug src <<<"$entry"
  [ -f "$src" ] || { echo "!!  missing source for $slug" >&2; exit 1; }

  echo "==> $slug"

  # Whisper wants 16kHz mono PCM.
  ffmpeg -v error -y -i "$src" -vn -ac 1 -ar 16000 -c:a pcm_s16le "$WORK/$slug.wav"

  whisper-cli \
    --model "$MODEL" \
    --file "$WORK/$slug.wav" \
    --output-vtt \
    --output-file "$WORK/$slug" \
    --max-len 42 \
    --split-on-word \
    --print-progress false \
    >/dev/null 2>&1

  for fix in "${FIXUPS[@]}"; do
    perl -pi -e "$fix" "$WORK/$slug.vtt"
  done

  # A hand-edited file wins. brand's cues were re-broken by hand so lines end
  # on whole thoughts, and four of its end times were pulled back to where the
  # speech actually stops -- Whisper writes each cue ending where the next
  # begins, which hands every pause to the line before it and leaves the word
  # highlight crawling seconds behind the voice. Without this check, a re-run
  # here plus an upload would quietly undo that work, and the only symptom
  # would be captions drifting again on the page.
  if [ -f "$slug-captions-merged.vtt" ]; then
    echo "    using hand-edited $slug-captions-merged.vtt (generated copy at $WORK/$slug.vtt)"
    cp "$slug-captions-merged.vtt" "dist/$slug/captions.vtt"
  else
    cp "$WORK/$slug.vtt" "dist/$slug/captions.vtt"
  fi
  lines=$(grep -c '^[0-9][0-9]:' "dist/$slug/captions.vtt" || true)
  echo "    $lines caption cues"
done

echo
echo "Review the text before shipping -- proper nouns are where these go wrong."
