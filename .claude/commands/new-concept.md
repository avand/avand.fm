# New Glossary Entry

Create a new entry in the Headroom DJ glossary at `headroom/concepts/` and register it in the glossary index.

## Arguments

- `$ARGUMENTS` — the concept name, optionally followed by a reference URL and/or adaptation instructions. Examples:
  - `unity gain` (no reference — write from your own knowledge)
  - `unity gain https://example.com/unity-gain` (pull from a reference)
  - `unity gain https://example.com/unity-gain "focus on the DJ-specific angle, skip the studio recording context"`

## Steps

1. Parse `$ARGUMENTS`: the first token(s) are the concept name (everything up to the first URL, if any). If a URL is present, everything after it is the adaptation prompt. If no URL is present, treat any remaining text after the concept name as adaptation/framing instructions instead.

2. If a reference URL was given, fetch it with WebFetch and extract the relevant content — supporting definition, body text, and any sub-sections worth keeping. If no URL was given, write the entry from your own knowledge of DJing and audio engineering — don't fabricate a source, just produce accurate, well-reasoned content directly.

3. Decide on a slug (lowercase, hyphenated) and page title for the term.

4. Write the new file to `headroom/concepts/<slug>/index.html` by copying the structure of the template at `headroom/concepts/gain-staging/index.html`. This site uses Jekyll: the shared nav, footer, fonts, CSS variables, and favicon script live in `_layouts/headroom.html`, so the page file only needs front matter plus its own content. Specifically:
   - Front matter: `layout: headroom`, `title`, `description`, `section: Concepts`, `section_url: /headroom/concepts/`, `subsection: <Term>`
   - A page-specific `<style>` block (copy entry-header/entry-content/callout/related/final-cta styles from the gain-staging template — these aren't in the shared layout since they're specific to concept entry pages)
   - Breadcrumb: Headroom (`/headroom/`) → Concepts (`/headroom/concepts/`) → [Term] — use absolute paths, not relative
   - `<h1>` = the term name
   - `part-of-speech` div (noun, verb, etc.)
   - `lead` paragraph = a one-sentence plain-English definition
   - Body content adapted from the source URL (if provided) per any adaptation instructions, or written from scratch (if no URL was provided). Either way, write in the Headroom voice: direct, technical but accessible, DJ-practitioner perspective. Cut studio-recording or live-sound-engineer content that isn't relevant to DJs. Use `<h2>` subheadings, `<p>`, `<ul>`, and `.callout` divs as appropriate.
   - Related terms links — only link to concept pages that actually exist yet (check `headroom/concepts/*/index.html`). Do not invent slugs for terms that haven't been written. If no existing entries are genuinely related, leave the `.related` section out of the new page entirely (it can be added later by step 6).
   - Same `.final-cta` section ("Want to go deeper?"), background image at `/headroom/djvibe-studiox-dt_UuLU_foM-unsplash.jpg`
   - Do NOT include `<html>`, `<head>`, `<nav>`, `<footer>`, or the favicon script — the layout provides all of that

5. Add the new term to `headroom/concepts/index.html`:
   - Read the current file.
   - Find or create the correct alphabetical `letter-group` section.
   - Insert a new `<li>` entry in alphabetical order within that group: term name + one-line description (pulled from the lead sentence).
   - Write the updated file.

6. Scan every other HTML page in the project for mentions of the new term (case-insensitive). Check at minimum:
   - `headroom/index.html`
   - `headroom/concepts/index.html` (already updated above — skip body scan)
   - Any other `headroom/concepts/*/index.html` entries
   - `index.html`, `about.html`, `sets.html` at the root
   For each file that contains the term as plain text (not already hyperlinked), replace the first occurrence with `<a href="/headroom/concepts/<slug>/">[term]</a>`. Do not add more than one link per page.

7. Update related terms across every existing concept page so the graph stays current in both directions:
   - For every other file in `headroom/concepts/*/index.html` (excluding the new one), judge whether it's genuinely related to the new term (shares a category, commonly confused, naturally referenced together, etc. — not just "both audio terms").
   - For each one that is related:
     - If it has a `.related` section, add a new `<a href="/headroom/concepts/<new-slug>/">[New Term]</a>` link to its `.related-list` (skip if already linked).
     - If it has no `.related` section yet, add one (copy the markup/structure from the gain-staging template) containing just this new link.
   - If the new entry itself ended up with related terms (per step 4), make sure those same pages link back to the new entry too — relations should be symmetric.

8. Report:
   - File path of the new entry
   - One-line summary of the term
   - List of files where a retroactive body link was added (or "none" if none found)
   - List of existing concept pages whose `.related` section was updated to point to the new entry (or "none" if none found)

## Voice guidelines

- Write for a DJ who is technically curious but not a recording engineer.
- Explain *why* something matters in the booth, not just what it is.
- Keep the tone confident and direct — no hedging, no "it's worth noting that."
- Use parentheses for asides, not em-dashes.
- Avoid jargon without explanation; when jargon is unavoidable, define it inline.
- Wherever possible, back the answer in science, without being overly technical.
- Try and use creative analogies when they make sense — bonus points if they're funny.
- The vibe is backed-by-science but not taking ourselves too seriously. Have fun with it.
