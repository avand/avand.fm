# Headroom video

The HLS ladder behind the [Headroom](https://avand.fm/headroom/) page: the
scripts that build it, the local preview server, and the one that publishes it.

Everything here is tracked. What it produces — `dist/`, about 400MB — is not,
and neither are the camera masters it is built from. Derived output lives in
Cloudflare R2, not in git.

## Where the video is served from

Cloudflare R2, bucket `headroom-video`, public at **https://video.avand.fm**.

The site loads it cross-origin, so the bucket's CORS rules allow `avand.fm`,
`www.avand.fm`, and `localhost:8100` for GET and HEAD, permit the `range`
request header, and expose `content-range` and `accept-ranges`.

R2 rather than GitHub Pages, where the site itself lives, for two reasons: the
1080p brand rendition alone is 76MB, past what Pages is meant to serve, and R2
charges nothing for egress. (GitHub *Releases* is a third option that does not
work at all: no CORS headers, and download URLs are short-lived signed links
marked as attachments.)

## Layout

Each video is a directory under `dist/`:

```
dist/brand/
  master.m3u8     multivariant playlist -- what the player loads
  360p.m3u8       one media playlist per quality rung
  360p.mp4        one media file per rung
  540p.m3u8  540p.mp4
  720p.m3u8  720p.mp4
  1080p.m3u8 1080p.mp4
  captions.vtt
  poster.jpg
```

The playlists address segments as byte ranges *inside* each rung's single file
(`#EXT-X-BYTERANGE`) rather than writing thousands of small segment files. Same
adaptive behaviour, 9 files per video instead of ~200 — which is also why the
host has to honour `Range` requests. A server that ignores them and returns
200 with the whole file looks like it works right up until playback.

## Rebuilding

Sources are the camera masters in `src/` (~2.1GB, gitignored). **They are the
only copy** — nothing else has them, and everything else here is derived from
them, so they are worth backing up somewhere off this machine.

```sh
./build.sh                                   # all ten videos, ~2 minutes
SOURCES=/path/to/masters ./build.sh          # masters on another disk
./transcode.sh some-source.mp4 my-slug 12    # one video, poster at 12s
```

`build.sh` holds the poster timestamp for each video. They are chosen by hand:
the module videos open on a ~5s title animation and close on an end card, so the
poster is pulled from the title card, which reads "MODULE 2 / Signal Flow".

## Publishing

```sh
./upload.sh                 # everything in dist/
./upload.sh brand m3-gear   # just those videos
```

Needs `CLOUDFLARE_API_TOKEN` (in `~/.zshrc.local`) — an R2 token with **Admin
Read & Write**. Object-level permission is not enough; it cannot set the
bucket's CORS policy.

Playlists upload with a 5-minute cache so a re-cut ladder is picked up the same
day. Media, captions, and posters get a year, since they only ever change by
being replaced under a new name.

Adding a video is: drop the master in `src/`, add a line to `build.sh`,
`./build.sh`, `./upload.sh <slug>`, then reference the slug in
`../headroom/index.html`.

## Previewing

```sh
../bin/dev      # then open http://localhost:8100/headroom/
```

Serves the site on one port and the video on another, with the CORS and
byte-range headers R2 sends, so a local preview exercises the real cross-origin
path. `player.js` points at `/video/` on any host that isn't `avand.fm`, so
nothing needs editing to preview — and that includes a phone on the tunnel.

`NO_TUNNEL=1 ../bin/dev` skips the tunnel, if local is all you want.

## Captions

```sh
./captions.sh   # transcribes every video to dist/<slug>/captions.vtt
```

Uses whisper.cpp (`brew install whisper-cpp`) and downloads a ~466MB model on
first run. The videos autoplay muted, so captions are the only thing saying
anything until a visitor turns sound on.

Transcription is accurate on ordinary speech but unreliable on proper nouns, so
`FIXUPS` in the script rewrites the terms it reliably gets wrong (rekordbox,
CDJs, AlphaTheta, Mixed In Key). Read the text before shipping. Note the fixups
run through `perl`, not `sed`: BSD sed reads basic regular expressions, where
`?` is a literal and `\b` means nothing, so the patterns silently match nothing.
