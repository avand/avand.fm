# avand.fm

A static site on GitHub Pages. The substantial part is `/headroom/` — a course
landing page, a 43-entry glossary, and a two-page application, all sharing one
Jekyll layout.

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

Five stylesheets, split by audience, not by tidiness:

| | |
|---|---|
| `headroom/css/headroom.css` | what every page under `/headroom/` presents **identically** — tokens, fonts, nav, footer, buttons, `.final-cta` (which all 50 concept pages render too) |
| `headroom/css/index.css` | the landing page's own furniture — hero, curriculum, timeline, modal, the CTA's two extra lines |
| `headroom/css/player.css` | the video player, at any size, wherever one appears |
| `headroom/concepts/concepts.css` | the glossary's own layout |
| `headroom/apply/apply.css` | the application and its confirmation page |

The test: **if a concept page would look wrong without it, it is shared. If a
concept page never renders the element, it is not.**

`player.css` is the exception that proves it, and worth reading before you
merge anything back into `index.css`. The player was landing-page furniture
until `/headroom/apply/done/` grew one. Loading `index.css` there instead
would have been the smaller diff and the wrong answer: that file sets
`body { background: var(--hero-top) }`, so any page without a hero renders as
a purple slab — the exact bug that once shipped to all 43 glossary entries.

`_layouts/headroom.html` is the shell, and its header comment lists the four
front-matter flags (`landing`, `apply`, `chrome`, `player`) and what each one
is for. The order of the stylesheet links is load-bearing — `index.css`
overrides `headroom.css`.

## Analytics

Two vendors, one file. `headroom/js/events.js` is the only place that knows either
exists — it loads the Fathom script and the OpenAI ads conversion pixel itself,
and only on `avand.fm`, so `bin/dev` and the tunnel report into neither the live
site nor the ad account. Set `localStorage["track-debug"] = "1"` to see
every event in the console; on any host but `avand.fm` that is the default.

Most events need no JavaScript. A `data-track` attribute is one:

```html
<a href="#cta" data-track="headroom / hero / cta">Apply now</a>
```

Note what that name is **not**: it does not say "apply". Every name here is the
place, not this month's offer — the same reason the anchor is `#cta` and not
`#notify`. The button has now said three different things and the name has
never had to move, which is what keeps a year of Fathom history comparable.

It works on a **container** too — one attribute on `.related-list` reports for
every link inside it — and a click only counts when it landed on a link or a
button, so the prose around them is not a giant hit target. External links
report themselves without an attribute at all.

**`data-track-view`** is the same idea for a section nobody clicks:

```html
<section class="instructor-band" data-track-view="headroom / instructor">
```

It fires once the element has settled on screen for a second, not when it is
crossed, so scrolling past reports nothing. `events.js` owns that clock and
exposes it as `Track.settle` / `Track.unsettle`, because the pinned curriculum
has to answer "is this on screen" from scroll offset rather than geometry —
its eight slides sit at one position and all read as visible at once — and only
that half differs. Two copies of the clock is two dwell constants that drift.

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

Coverage and **one** other thing: `started`, fired from the `playing` event.
There is still no pause, autoplay, mute, volume or complete event, and the code
for them is gone rather than switched off. `pause` was the last to go: on a
video that autoplays muted, reaching the sound through the control bar means
pressing play once to pause and again to resume, so every viewer who wanted
audio filed a pause on the way and the signal was a mix of "stop this" and
"let me hear it".

`started` came back because coverage has no denominator. It says nothing at
all below its first step, and that step is a fifth of the video — 42 seconds
of the brand film against 8 of a curriculum clip. Seven days of the brand
video reporting nothing was indistinguishable from seven days of it being
broken. Against `started`, a run of zeroes is an answer rather than an
absence.

Read it as **the video began**, not as somebody chose it. On the autoplaying
brand film it fires when the player scrolls a quarter into view, so it counts
arrivals at that part of the page; on the `data-manual` curriculum players it
does mean a press. That ambiguity is why the old play/autoplay events were
removed and it is not a reason to leave this one out — a denominator counts
everybody, and the muted and unmuted coverage series are what separate the two
afterwards.

It is on `playing` rather than `play`, because `play` fires on the attempt: an
autoplay the browser then refuses, or a press that stalls on a dead
connection, would each count a start that never happened.

Where JavaScript is unavoidable, call through the guard: `if (window.Track)
Track.event("…")`. The guard is not superstition — the file is same-origin but
ad blockers match on filenames, which is also why it is not called
`analytics.js`. `window.Track` and nothing more: the failure it guards is
all-or-nothing, so there is no state where `Track` exists but a method on it
does not, and `if (window.Track && Track.lead)` would imply a hazard that
cannot happen.

Nothing in that guard, though, keeps a throw *inside* it from escaping. The
signup form used to wrap its analytics for that reason; the application does
not need to, because its conversion fires on a *different page* from the one
that accepted it — see below.

## The ad pixels are a different animal

Fathom counts behaviour and nobody is billed by the answer. The OpenAI pixel
exists to tell an ad account that money produced an application, and it reports
exactly one thing — `lead_created`, from `Track.lead()`, fired **once, from
`/headroom/apply/done/`**. Not on submit: an application the Apps Script
rejects is not a lead, and a campaign bidding toward a number that includes
failures buys the wrong traffic.

Three things about that placement, each of which was a bug on the way here:

**It fires on the page after the one that accepted it.** `Track.lead()` is an
async call into a script fetched from `bzrcdn.openai.com`; firing it on the
apply page and navigating in the next line is a race the navigation usually
wins. `/headroom/sample/register` documents the same race for a Fathom event,
which is why that page tracks nothing at all.

**The confirmation page therefore needs the applicant's details, and gets them
through `sessionStorage`.** The stash is removed *before* the call, so a reload
cannot report a second conversion for one application, and someone who types
the URL converts nothing. Only the **first** name is stashed: OpenAI's field is
`first_name_sha256`, and `normalizeName` strips whitespace, so handing it a
full name hashes `firstnamelastname` and matches nobody.

**Every link into the flow forwards `location.search`.** `fromAd()` matches on
`oppref` in the query string *or* the `__oppref` cookie. On the landing page
the query string is always there, so the cookie never mattered; two navigations
later there is none, and the cookie is written by that same ad-tech script — so
without forwarding, a blocked SDK means no cookie, no attribution, and a zero
that looks like nobody applied.

Its event names come from OpenAI's fixed vocabulary and have nothing to do with
the `page / section / element` scheme above.

**Reddit's pixel is the same animal on the same terms**, and `lead()` fans out
to both from the one call site so the confirmation page does not have to know
how many advertisers exist. It loads only for a visitor carrying `rdt_cid`,
Reddit's click id — which rides through the whole funnel for free, because
every link into `/headroom/apply/` already forwards `location.search`.

Two differences from the OpenAI half, both deliberate:

`fromReddit()` checks **only the query string**, with no cookie fallback.
`__oppref` is a *click* reference, written only when `oppref` was in the URL, so
testing it asks "did this browser arrive from an ad once" — a fair question.
Reddit's `_rdt_uuid` is a per-browser id written for everyone the pixel runs
for, so testing it would ask whether the pixel had already run, which is
circular. The cost is that a visitor returning days later by typing the URL is
not recognised.

`REDDIT` is **empty until somebody pastes the advertiser id in**, and every
path checks it first, so the file is safe to ship ahead of the account
existing. Nothing loads, nothing is stored, nothing is sent while it is blank.

The conversion carries a `conversionId` — the same `eventId()` the OpenAI half
uses. That is the deduplication key for the Conversions API: if the server-side
half is ever wired up, the same application is reported twice and Reddit
collapses the pair only when both carry the same id.

It **initialises on the concept pages too, but only for visitors who arrived
from an ad** — `fromAd()` in `events.js`. Both halves of that matter. An ad can
point at a glossary entry, and a page without the pixel is a click that can
never be attributed, so it cannot be landing-page-only. But it has no business
running for anyone else: `init` sets `__obref`, a per-browser identifier with a
**one year** lifetime, for every visitor it runs for — which the help-centre
docs do not mention and the minified SDK does. Verify claims about that pixel
against the SDK, not the docs.

**Meta's pixel is the third of the same animal**, gated on `fbclid` and firing
`Lead` with an `eventID` — capital I, capital D, and not spelled like Reddit's
`conversionId` or OpenAI's `event_id`, though all three carry the same value.

`fromMeta()` takes a cookie fallback and `fromReddit()` does not, which is the
one place the three gates genuinely differ. Meta writes two cookies and only
one is fair to test: `_fbc` is the *click* reference, written only when
`fbclid` was in the URL, so it asks the same question `__oppref` answers for
OpenAI. `_fbp` is a per-browser id written for everybody the pixel runs for, so
testing it would ask whether the pixel had already run — circular, the same
trap `_rdt_uuid` sets.

**The `<noscript>` half of Meta's snippet is deliberately not here.** It fires
an `<img>` for every visitor without JavaScript, which walks straight through
the gate: everyone who blocks scripts would be reported *because* they blocked
scripts, ad click or not. If you ever paste Meta's snippet in fresh, drop that
half again.

**Meta has a server-side half too**, `metaConversion_` in `signup.gs`, posting
to `graph.facebook.com/v26.0/<dataset>/events`. The dataset id is the same
number as the browser pixel's — Meta renamed "pixel" to "dataset" and one id
now names both — which is what lets `event_id` collapse the browser report and
the server one into a single conversion. Token in Script Properties under
`META_CAPI_TOKEN`; absent, it returns without sending.

Three things differ from the Reddit half and each was checked against the API
rather than assumed:

- **`event_time` is in seconds.** Reddit's `event_at` is milliseconds. Sending
  ms here puts the event fifty thousand years out and Meta rejects it as
  outside the seven-day window, which reads as a range error, not a units one.
- **Contact fields are hashed; `fbc` and `fbp` are not.** Meta's payload helper
  says it outright: everything is SHA-256 "except for client IP address,
  client user agent, click ID, and browser ID". Hashing a click id destroys
  the only thing it is for.
- **The phone is digits with the country code and no `+`.** The page
  normalises to E.164 for Reddit; Meta's own example is `16505551234`. Hashing
  the `+` in produces a digest of a different string that matches nobody and
  looks perfectly fine.

**A payload can be validated without recording anything.** An invalid
`action_source` is rejected before storage, so a request carrying every real
field plus a bad `action_source` tells you whether the token authenticates and
whether any field name is wrong, and lands nowhere. That is how the shape above
was confirmed. A `Missing Permission` on a plain GET of the dataset is not a
broken token — reading dataset metadata is a different permission from posting
events to it.

**What is deliberately NOT built is Meta's Qualified Leads / CRM integration**,
which uses the same endpoint with `action_source: "system_generated"`,
`custom_data.event_source: "crm"` and a `lead_id`. That reports a lead moving
between funnel stages and is built around the `lead_id` Meta mints for its own
Instant Forms. The application is a form on this site, so there is no
`lead_id`, and the only stage that fires automatically is the one the pixel
already reports. It becomes worth having if Instant Forms ever run, and it is a
second function beside `metaConversion_` rather than a change to it.

None of it can be exercised locally: it is inside the same `avand.fm` gate as
Fathom, and `crypto.subtle` (used to hash the email) does not exist over plain
http anyway. Verifying means one real application on production.

## The signup endpoint lives in Google, and is deployed from here

`apps-script/signup.gs` is the Apps Script Web App every form on the site POSTs
to — the application, privacy requests and unsubscribes, told apart by a `kind`
field. It writes into the "Headroom CRM" Sheet, one tab per kind, and it is the
only server-side code in this repo. Its own header comment covers what it does and why it is shaped that
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
deployment means a new `/exec` URL, and the forms would still be posting at the
old one. `bin/apps-script` finds that deployment by reading the endpoint URL out
of the page — the URL the site uses and the deployment that gets advanced are
then the same fact, not two copies of it. It reads `headroom/apply/apply.js`
now — it used to read `headroom/index.html`, which held the mailing-list form
until that form became the application. If the endpoint ever moves again,
`ENDPOINT_FILE` in `bin/apps-script` moves with it; the failure if it does not
is a loud one.

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
| `headroom/js/*.js` | `?v=` on the script tags in `headroom/index.html` (all five together) |
| `headroom/js/player.js` | those five **and** the one in `headroom/apply/done/index.html` — two pages load it now |
| `headroom/js/events.js` | its `?v=` in `_layouts/headroom.html` — it is loaded there, not from `index.html` |
| `headroom/apply/apply.js` | its `?v=` in `headroom/apply/index.html` |
| any `.css` under `headroom/` | that file's `?v=` in `_layouts/headroom.html` — all five are linked from there |
| any `captions.vtt` re-uploaded to R2 | `CAPTIONS_V` in `headroom/js/player.js` |

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
