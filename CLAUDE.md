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

Two vendors, one file. `headroom/events.js` is the only place that knows either
exists — it loads the Fathom script and the OpenAI ads conversion pixel itself,
and only on `avand.fm`, so `bin/dev` and the tunnel report into neither the live
site nor the ad account. Set `localStorage["track-debug"] = "1"` to see
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
`headroom / brand / video / watched-60`. Do not put a plain `data-track` on a
player root: every press of its play button would report the stem as if it
were an event.

The naming scheme, and why the name has to carry everything Fathom cannot, is
documented at the top of `events.js`. Read it before inventing a name.

Every video reports two things and no others: how much of it was heard, in
fifths, and how much of it was watched in silence. `watched-20` through
`watched-100`, and `watched-muted-20` through `watched-muted-100`. They are
coverage, not position — a set of the seconds actually played, so seeking past
something never counts it and watching it twice never counts it twice. The note
above `trackProgress` in `player.js` is the whole argument; the short version
is that the milestones this replaced measured where the playhead had reached,
which overstates by an amount nobody can recover afterwards.

The two are **disjoint**. Every second is filed by whether sound was on when it
played, so a video watched all the way through in silence reports the muted
series and nothing else — there is no combined total, and adding the two is the
reader's job. That is deliberate: a muted 80% and an 80% with the sound on are
different findings about a video of somebody talking, and one number would hide
which you had.

Fifths, not twentieths, because all nine players carry `data-track-progress`
now. Ten names each is a list somebody can read; the same thing in twentieths
is four hundred, nearly all of them holding a one. Fathom only lists names that
have fired, so the number that matters is smaller than that — but the ceiling
is what decides whether the page is legible on the day everything works.

`pause` is the only other event a player reports. Coverage cannot tell somebody
who stopped the video from somebody who wandered off, and on a landing page
that is the difference between rejection and distraction.

Where JavaScript is unavoidable, call through the guard: `if (window.Track)
Track.event("…")`. The guard is not superstition — the file is same-origin but
ad blockers match on filenames, which is also why it is not called
`analytics.js`. `window.Track` and nothing more: the failure it guards is
all-or-nothing, so there is no state where `Track` exists but a method on it
does not, and `if (window.Track && Track.lead)` would imply a hazard that
cannot happen.

Nothing in that guard, though, keeps a throw *inside* it from escaping. See
the note at the signup form's success branch.

## The OpenAI pixel is a different animal

Fathom counts behaviour and nobody is billed by the answer. The OpenAI pixel
exists to tell an ad account that money produced a signup, and it reports
exactly one thing — `lead_created`, from `Track.lead()`, on the success branch
of the signup form. Not on submit: a submission the Apps Script rejects is not
a lead, and a campaign bidding toward a number that includes failures buys the
wrong traffic.

Its event names come from OpenAI's fixed vocabulary and have nothing to do with
the `page / section / element` scheme above.

It **initialises on the concept pages too, but only for visitors who arrived
from an ad** — `fromAd()` in `events.js`. Both halves of that matter. An ad can
point at a glossary entry, and a page without the pixel is a click that can
never be attributed, so it cannot be landing-page-only. But it has no business
running for anyone else: `init` sets `__obref`, a per-browser identifier with a
**one year** lifetime, for every visitor it runs for — which the help-centre
docs do not mention and the minified SDK does. Verify claims about that pixel
against the SDK, not the docs.

None of it can be exercised locally: it is inside the same `avand.fm` gate as
Fathom, and `crypto.subtle` (used to hash the email) does not exist over plain
http anyway. Verifying means one real signup on production.

## The signup endpoint lives in Google, and is deployed from here

`apps-script/signup.gs` is the Apps Script Web App the signup form POSTs to. It
writes into the "Headroom CRM" Sheet, and it is the only server-side code in
this repo. Its own header comment covers what it does and why it is shaped that
way; this is about moving it.

```sh
bin/apps-script status   # who you are, which script, which deployment, and any drift
bin/apps-script check    # does the live form match apps-script/? exit 1 if not
bin/apps-script pull     # bring the live editor's code down (do this in a fresh clone)
bin/apps-script push     # upload -- does NOT change what the form hits
bin/apps-script deploy   # push, cut a version, advance the form's deployment
```

**Deploy the script before merging the page, always.** These are two separate
releases — merging to `master` publishes the site, and nothing about that touches
Google — so there is a window where one is new and the other is old. Which
window you get is the only part you control.

There is no version of this where they change together. Pages caches for ten
minutes and browsers hold copies for longer, so at every merge there are people
running last week's page against whatever is deployed right now. That is why the
endpoint has to stay backward compatible with the page before it — the `kind`
check in `doPost` exists for exactly that reason. Deploy-first is just the
ordering that keeps the gap inside a guarantee the endpoint already has to make:
new script, old page. Merge-first is the other one, old script and new page, and
nothing protects that.

`bin/apps-script check` is what makes a forgotten deploy visible. It does not
compare version numbers — it pulls the version the form is actually serving and
diffs it against `apps-script/`, so it answers the real question, which is
whether visitors are running this code. Run it before merging.

**Push and deploy are not the same thing, and the difference is silent.** A push
replaces the code in Google's online editor. The form does not run that code --
it posts to a *deployment*, a frozen snapshot of an earlier version, and keeps
running it until something advances it. So a push alone changes nothing a
visitor can see, and the execution log will show the old code running while your
new file sits right there. `deploy` is what closes that.

It advances the **existing** deployment rather than making a new one: a new
deployment means a new `/exec` URL, and the form would still be posting at the
old one. `bin/apps-script` finds that deployment by reading `SIGNUP_ENDPOINT`
out of `headroom/index.html` — the URL the site uses and the deployment that
gets advanced are then the same fact, not two copies of it.

`clasp`'s login is global, not per-repo. The Sheet and the script are both under
`avand@avandamiri.com`; pushing as anyone else fails with a bare 404 on the
script id, which reads like a wrong id rather than a wrong account.

`apps-script/` is in `_config.yml`'s `exclude`. Left out of it, Jekyll copies it
into `_site` and Pages serves it — `https://avand.fm/headroom/signup.gs` used to
return the whole file.

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
