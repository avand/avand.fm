/*
 * Hero.
 *
 * This used to be a 480vh scroll-jacked region: a sticky viewport held in
 * place while a scroll listener rewrote transform/opacity custom properties
 * every frame, rising the brand video up into a locked, centred position.
 * Whether that math ran in JS or in a native scroll-timeline, it read as
 * jittery on iOS -- so it's gone. This is just a page now: the pitch, then
 * the video, then the curriculum lead-in, in normal document flow.
 *
 * What's left here: warming the video's source a little before it scrolls
 * into view, so playback doesn't stall right when it's wanted, and revealing
 * the curriculum heading's words as it arrives. The timeline used to need a
 * flag from here to know the reader had got that far; it is in the document
 * now and watches itself.
 */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function brand() {
    return window.Headroom ? window.Headroom.get("brand") : null;
  }

  /* ---------- Warm the video before it arrives ---------- */

  var videoEl = document.querySelector(".hero-video");

  if (videoEl && "IntersectionObserver" in window) {
    // A whole viewport of margin below: ready by the time it's wanted,
    // without paying for it the moment the page loads.
    var warmObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var player = brand();
          if (player) player.warm();
          warmObserver.disconnect();
        });
      },
      { rootMargin: "0px 0px 100% 0px" }
    );
    warmObserver.observe(videoEl);
  }

  /* ---------- The nav's CTA follows the hero's ----------
   *
   * Two of the same button on screen at once is one too many, and the nav one
   * has nothing to add while the hero's is still in front of the reader. So it
   * stays away until the hero's scrolls out of view, then builds itself in and
   * picks up the sweep from the start.
   *
   * The hidden state is in the stylesheet, gated on a .js class set in the
   * document head -- applying it from here meant the button painted once and
   * then vanished. This file only decides when it comes back.
   */
  var heroCta = document.querySelector(".hero-content .btn-primary");
  var navCta = document.querySelector(".site-nav .cta-nav");
  var siteNav = document.querySelector(".site-nav");

  /* The canvas colour is what iOS paints behind the status bar at rest. It
     starts as the hero's top row and becomes the page background once the nav
     has arrived, because by then the nav is what is up there. */

  /* One place that knows what "past the hero" means. It was written out twice
     -- once in the observer, once on load -- with the two predicates already
     drifting apart. */
  function setPast(past) {
    if (navCta) navCta.classList.toggle("is-visible", past);
    if (siteNav) siteNav.classList.toggle("is-visible", past);
    document.body.classList.toggle("is-past-hero", past);
  }

  /* The stylesheet translates the whole bar off screen and waits for
     .is-visible to bring it back, so anything that stops the observer from
     running strands the nav off screen for the entire page. If the pieces this
     depends on are missing, show it and leave it shown. */
  if (!heroCta || !navCta || !("IntersectionObserver" in window)) {
    setPast(true);
  }

  /* Where the reader actually is, asked rather than remembered.
   *
   * The observer below is the thing that notices in the ordinary case, but it
   * reports crossings and not state, and there is a real case it cannot see.
   * On a phone the hero's button starts below the fold, so it begins life not
   * intersecting. Reload the page while scrolled down the curriculum and the
   * browser restores that scroll position in one jump -- the button goes from
   * off the bottom to off the top without ever being on screen, the ratio is 0
   * before and 0 after, and no callback is ever delivered. The nav stayed away
   * and the canvas stayed on its hero purple behind the status bar, which is
   * exactly what a reload looked like.
   *
   * Same shape as the deep-link bug this file already carries a note about,
   * and the same answer: derive it from the element's position instead of
   * waiting to be told.
   */
  function syncPast() {
    if (heroCta) setPast(heroCta.getBoundingClientRect().bottom <= 0);
  }

  if (heroCta && navCta && "IntersectionObserver" in window) {
    /* Once, and then never again.
     *
     * The only thing this is here to catch is the restore itself -- a single
     * event, at load, delivering a scroll position the observer cannot see the
     * page arrive at. After that the observer is correct about everything,
     * because from then on the button is crossed rather than jumped over.
     *
     * It was a live listener for about an hour and that was a mistake worth
     * recording. getBoundingClientRect on every scroll frame is a forced
     * layout on every scroll frame, and it showed up as exactly what this
     * page spent its whole history removing: the pinned curriculum picked up
     * a vertical shake. One shot costs one rect read, for good.
     */
    window.addEventListener("scroll", syncPast, { passive: true, once: true });
    // Restoring from the back/forward cache does not re-run load.
    window.addEventListener("pageshow", syncPast);

    var ctaObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          /* "Not on screen" is true in both directions -- scrolled past it,
             and not yet reached. On a phone the hero's button often starts
             below the fold, so not-intersecting alone put the nav one up
             immediately, which is the opposite of the point. Only once it has
             gone off the *top*. */
          var scrolledPast = entry.boundingClientRect.bottom <= 0;
          // The bar itself travels on the same signal: away while the hero has
          // the screen to itself, down into place once it doesn't.
          setPast(!entry.isIntersecting && scrolledPast);
        });
      },
      { threshold: 0 }
    );
    ctaObserver.observe(heroCta);

    /* A page can arrive already scrolled past the hero -- a reload, or a deep
       link straight to a module -- and the observer's first report can land
       before that jump has happened, leaving the nav away and the canvas on
       its hero colour behind the status bar. Settle it once the page has
       finished loading, from the element's actual position. */
    window.addEventListener("load", function () {
      syncPast();

      /* Again, after every other load handler has run. A deep link to a module
         is resolved in one of those: it jumps the page to the week and opens
         the dialog, which sets overflow:hidden on the body. Both happen after
         this file's handler, so the check above still sees the top of the page
         -- and once the body cannot scroll, no scroll event ever arrives to
         correct it through the observer. The canvas stayed on its hero purple
         behind the status bar for as long as the dialog was open, then snapped
         to the page colour the moment it closed and scrolling resumed.

         A timeout of 0 is not a guess at how long that takes: load handlers
         all run in the same task, and this runs in the next one, so it is
         ordered after them however many there are. */
      setTimeout(syncPast, 0);
    });
  }

  /* ---------- Curriculum intro: words arrive one at a time ---------- */

  var intro = document.getElementById("hero-intro");

  function splitWords() {
    if (!intro) return;
    var index = 0;

    intro.querySelectorAll(".reveal").forEach(function (el) {
      var words = el.textContent.trim().split(/\s+/);
      el.textContent = "";

      words.forEach(function (word, i) {
        var span = document.createElement("span");
        span.className = "word";
        span.textContent = word;
        // A short, even beat: long enough to read as a build, short enough
        // that the last word isn't still arriving after the reader is done.
        span.style.transitionDelay = index * 38 + "ms";
        el.appendChild(span);
        if (i < words.length - 1) el.appendChild(document.createTextNode(" "));
        index++;
      });
    });
  }

  if (intro) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      intro.classList.add("is-revealed");
    } else {
      splitWords();
      var introObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            intro.classList.add("is-revealed");
            introObserver.disconnect();
          });
        },
        { threshold: 0.4 }
      );
      introObserver.observe(intro);
    }
  }
})();
