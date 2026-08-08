#!/usr/bin/env bash
#
# Transcode a source video into a byte-range HLS ladder for web delivery.
#
#   ./transcode.sh <source.mp4> <slug> [poster-seconds]
#
# Produces dist/<slug>/ containing:
#   master.m3u8     the multivariant playlist the player loads
#   <h>p.m3u8       one media playlist per quality rung
#   <h>p.mp4        one media file per rung (playlists address it by byte range)
#   poster.jpg      first-frame poster, also used as the og:image candidate
#
# Rungs above the source resolution are skipped, so a 720p source yields a
# 3-rung ladder rather than an upscaled 1080p rung that costs bytes and adds
# nothing.

set -euo pipefail

SRC=${1:?usage: transcode.sh <source.mp4> <slug> [poster-seconds]}
SLUG=${2:?usage: transcode.sh <source.mp4> <slug> [poster-seconds]}
POSTER_AT=${3:-1}

OUT="dist/$SLUG"
rm -rf "$OUT"
mkdir -p "$OUT"

probe() { ffprobe -v error -select_streams v:0 -show_entries "stream=$1" -of csv=p=0 "$SRC" | head -1; }

SRC_H=$(probe height)
SRC_W=$(probe width)
FPS_RAW=$(probe r_frame_rate)
FPS=$(awk -F/ '{ printf "%.0f", ($2 ? $1/$2 : $1) }' <<<"$FPS_RAW")
[ "$FPS" -gt 0 ] 2>/dev/null || FPS=30

# Two-second segments, with keyframes locked to segment boundaries across every
# rung so the player can switch quality mid-playback without a visible seam.
GOP=$((FPS * 2))

# height:crf:maxrate:bufsize:audio-bitrate
LADDER=(
  "360:24:900k:1800k:96k"
  "540:23:1600k:3200k:128k"
  "720:23:3000k:6000k:128k"
  "1080:23:5400k:10800k:128k"
)

echo "==> $SLUG  (source ${SRC_H}p @ ${FPS}fps)"

VARIANTS=()
for rung in "${LADDER[@]}"; do
  IFS=: read -r H CRF MAXRATE BUFSIZE ABR <<<"$rung"

  # Skip rungs that would upscale. The lowest rung always renders so that even
  # a small source still has a fallback for poor connections.
  if [ "$H" -gt "$SRC_H" ] && [ "$H" != "360" ]; then
    echo "    ${H}p  skipped (source is only ${SRC_H}p)"
    continue
  fi

  ffmpeg -y -v error -stats -i "$SRC" \
    -vf "scale=-2:$H:flags=lanczos" \
    -c:v libx264 -profile:v high -level 4.1 -preset slow -crf "$CRF" \
    -maxrate "$MAXRATE" -bufsize "$BUFSIZE" -pix_fmt yuv420p \
    -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
    -c:a aac -b:a "$ABR" -ac 2 -ar 48000 \
    -f hls -hls_time 2 -hls_playlist_type vod \
    -hls_segment_type fmp4 -hls_flags single_file \
    -hls_fmp4_init_filename "${H}p.mp4" \
    -hls_segment_filename "$OUT/${H}p.mp4" \
    "$OUT/${H}p.m3u8"

  BYTES=$(wc -c <"$OUT/${H}p.mp4" | tr -d ' ')
  DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$SRC")
  # Advertise the real average bitrate rather than the cap; the player uses this
  # to pick a starting rung, and an inflated number makes it start too low.
  BANDWIDTH=$(awk -v b="$BYTES" -v d="$DUR" 'BEGIN { printf "%d", (b*8)/d }')

  # Mirror what scale=-2:H produces, so the advertised resolution matches the
  # real one even when the source is not 16:9 (vertical or letterboxed clips).
  W=$(awk -v w="$SRC_W" -v h="$SRC_H" -v t="$H" 'BEGIN { printf "%d", int((w*t/h)/2+0.5)*2 }')

  # Read the profile and level actually chosen by the encoder and build the
  # RFC 6381 codec string from it. Advertising the wrong one makes some players
  # discard a rung outright.
  read -r PROF LVL < <(ffprobe -v error -select_streams v:0 \
    -show_entries stream=profile,level -of csv=p=0 "$OUT/${H}p.m3u8" 2>/dev/null | tr ',' ' ')
  case "$PROF" in
    High) PROF_HEX=6400 ;;
    Main) PROF_HEX=4d40 ;;
    *)    PROF_HEX=6400 ;;
  esac
  [ -n "${LVL:-}" ] && [ "$LVL" -gt 0 ] 2>/dev/null || LVL=41
  CODECS=$(printf 'avc1.%s%02x,mp4a.40.2' "$PROF_HEX" "$LVL")

  VARIANTS+=("$BANDWIDTH:$W:$H:$CODECS")
  printf "    %sp  %s\n" "$H" "$(du -h "$OUT/${H}p.mp4" | cut -f1)"
done

# Master playlist, highest quality last so players that ignore bandwidth
# estimation and take the first entry start conservatively.
{
  echo "#EXTM3U"
  echo "#EXT-X-VERSION:7"
  for v in "${VARIANTS[@]}"; do
    IFS=: read -r BW W H CODECS <<<"$v"
    echo "#EXT-X-STREAM-INF:BANDWIDTH=${BW},RESOLUTION=${W}x${H},CODECS=\"${CODECS}\""
    echo "${H}p.m3u8"
  done
} >"$OUT/master.m3u8"

ffmpeg -y -v error -ss "$POSTER_AT" -i "$SRC" -frames:v 1 \
  -vf "scale=-2:720:flags=lanczos" -q:v 4 "$OUT/poster.jpg"

echo "    poster.jpg  $(du -h "$OUT/poster.jpg" | cut -f1)   total $(du -sh "$OUT" | cut -f1)"
