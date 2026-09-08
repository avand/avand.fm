# Logo

Three assets, one per place the brand appears:

| file | where | drawn at |
|---|---|---|
| `lockup.svg` | the nav, in place of "avand.fm / headroom" | ~28px tall |
| `wordmark.svg` | the hero, in place of the `<h1>` text | up to ~440px wide |
| `mark.svg` | the footer, under the colophon | ~44px |

**Vector, so there is no size to get right.** Each carries a `viewBox` and
nothing else fixed, and the CSS sets the width; one file is sharp on every
screen at every breakpoint. That is the whole reason these are SVG rather
than the WebP they briefly were: a raster would have needed a size chosen
per slot, doubled for 2x screens, and revisited every time a slot changed.
All three together are about 8.5KB, which is less than the WebP versions of
the same three at one size each.

They are pure `<path>` data -- no embedded raster, no `<text>`, so no font
has to load or match, and no editor metadata to strip.

The orange is `#FF6116`, which is `--warm` in headroom.css exactly. That is
worth knowing before anyone "fixes" either one: they are the same colour on
purpose, and the stylesheet's copy is the one that has to follow if the
brand ever moves.

No `?v=` on these, unlike the stylesheets and scripts. A logo changes when
the art changes, which is a new file rather than a new version of an old
one -- so a changed logo gets a changed filename and the cache sorts itself
out. Nothing else has to agree about their version.
