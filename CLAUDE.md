# avand.fm

A static site on GitHub Pages. The substantial part is `/headroom/` — a course
landing page and a 43-entry glossary, sharing one Jekyll layout.

Most of what you need to know is in comments next to the thing it explains, and
that is on purpose: this file is only for what you cannot find by opening the
file you are about to edit.

## Building it

Use the Gemfile. Always.

```sh
bundle exec jekyll build     # or bin/dev, below
```

`gem install jekyll` gets Jekyll 4. GitHub Pages builds with **3.10**, which is
what `github-pages` in the Gemfile pins, and the two render differently in ways
that look fine right up until they do not. `mise.toml` pins the Ruby that goes
with it.

There is no CI and no build step of our own. **Deploying is merging to
`master`** — GitHub's classic Pages builder does the rest.

## Previewing

```sh
bin/dev                 # builds with Jekyll, serves _site on :8100, opens a tunnel
NO_TUNNEL=1 bin/dev     # local only
```

Video always comes from R2 (`video.avand.fm`), in preview exactly as in
production, so a fresh clone can show the page without building 400MB of
renditions. `video/README.md` covers the ladder, captions, and uploads.

## Where a new CSS rule goes

Three stylesheets, split by audience, not by tidiness:

| | |
|---|---|
| `headroom/headroom.css` | what the landing page and the glossary present **identically** — tokens, fonts, nav, footer, buttons, the CTA's presentation |
| `headroom/index.css` | the landing page's own furniture — hero, curriculum, player, timeline, modal, signup |
| `headroom/concepts/concepts.css` | the glossary's own layout |

The test: **if a concept page would look wrong without it, it is shared. If a
concept page never renders the element, it is not.**

`_layouts/headroom.html` is the shell. One front-matter flag, `landing: true`,
turns on everything specific to the landing page. The order of the stylesheet
links is load-bearing — `index.css` overrides `headroom.css`.

## Analytics

Fathom. `headroom/events.js` is the only file that knows that — it loads the
Fathom script itself, and only on `avand.fm`, so `bin/dev` and the tunnel do
not report into the live site. Set `localStorage["track-debug"] = "1"` to see
every event in the console; on any host but `avand.fm` that is the default.

Most events need no JavaScript. A `data-track` attribute is one:

```html
<a href="#cta" data-track="headroom / hero / cta">Join a free sample class</a>
```

It works on a **container** too — one attribute on `.related-list` reports for
every link inside it — and a click only counts when it landed on a link or a
button, so the prose around them is not a giant hit target. External links
report themselves without an attribute at all.

`data-track` always holds a **complete** name, because `events.js` fires it
verbatim on click. The video players carry **`data-track-prefix`** instead — a
stem that `player.js` finishes with an action, giving
`headroom / brand / video / sound-on`. Do not put a plain `data-track` on a
player root: every press of its play button would report the stem as if it
were an event.

The naming scheme, and why the name has to carry everything Fathom cannot, is
documented at the top of `events.js`. Read it before inventing a name.

**Only the landing page fires events.** The concept pages did, briefly, and the
eleven names it took were noise next to the pageviews those pages already
produce. `events.js` still loads on them, because it is what loads Fathom.

Where JavaScript is unavoidable, call through the guard: `if (window.Track)
Track.event("…")`. The guard is not superstition — the file is same-origin but
ad blockers match on filenames, which is also why it is not called
`analytics.js`.

## Cache-busting is manual, and forgetting is silent

Assets are served at fixed URLs. GitHub Pages caches them for 10 minutes;
R2 caches captions for **a year**. Nothing errors when you forget — the change
simply reaches nobody, including you.

| you changed | bump |
|---|---|
| `headroom/*.js` | `?v=` on the script tags in `headroom/index.html` (all five together) |
| `headroom/events.js` | its `?v=` in `_layouts/headroom.html` — it is loaded there, not from `index.html` |
| `headroom/headroom.css`, `index.css`, `concepts/concepts.css` | that file's `?v=` in `_layouts/headroom.html` |
| any `captions.vtt` re-uploaded to R2 | `CAPTIONS_V` in `headroom/player.js` |

Bump in the **same commit** as the change. A hook warns when you don't.

These query strings do nothing in development — `bin/dev` rewrites local
`.js`/`.css` references to `?d=<mtime>` and discards whatever was there. They
are for production only.

## You cannot see what you are changing

Nothing in this repo verifies rendering. Structure, links, and the Jekyll build
can all be checked; appearance cannot. Anything visual needs a real device, and
iOS Safari in particular, before it is called done.

Three bugs found on a phone that every automated check passed: `overflow-clip-margin`
is unsupported in Safari and cut the timeline's end dots in half; a `theme-color`
meta made the URL bar paint itself opaque (Safari 26 discards the value anyway —
the note above `.site-nav` says so); and the body's hero purple leaked onto all
43 glossary pages, which have no hero to justify it.

Say what you verified and what you did not.
