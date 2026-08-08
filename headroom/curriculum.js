/*
 * Scroll-driven curriculum.
 *
 * The eight modules occupy one pinned viewport. Scrolling inside that region
 * advances week to week instead of moving the page: the outgoing slide's video
 * peels away, the incoming one takes its place and starts playing muted, and
 * the text staggers in behind it. Past the last module, the page scrolls on
 * normally.
 *
 * This is deliberately not a scroll hijack. The page never fights the scroll
 * position or animates it; the region is simply tall, held in place by
 * position: sticky, and the scroll offset inside it picks which slide is shown.
 * Scrolling stays exactly as fast and as interruptible as the reader expects,
 * trackpad momentum and all, and Escape-hatch behaviours like find-in-page and
 * jumping to an anchor keep working.
 *
 * A phone gets the same sequence, on a compacted type scale that keeps a slide
 * inside one screen. It switches off only where a slide genuinely cannot fit --
 * very small or very short viewports -- and for anyone who asked for reduced
 * motion. Those fall back to the plain stacked list, with each video playing as
 * it scrolls into view.
 */
(function () {
  "use strict";

  var scroller = document.getElementById("curr-scroll");
  if (!scroller) return;

  var slides = Array.prototype.slice.call(
    scroller.querySelectorAll(".curr-slide")
  );
  if (!slides.length) return;

  // Pinning needs room for a whole slide on one screen. Measured against the
  // tallest of them, a 390x844 phone clears it with the compact scale; below
  // that there is not enough height, so the stacked list takes over.
  var pinnedQuery = window.matchMedia(
    "(min-width: 380px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)"
  );

  var pinned = false;
  var active = -1;
  var ticking = false;

  function playerFor(slide) {
    var el = slide.querySelector(".player");
    return el && window.Headroom ? window.Headroom.get(el.dataset.video) : null;
  }

  function setActive(index, direction) {
    if (index === active) return;
    var previous = active;
    active = index;

    slides.forEach(function (slide, i) {
      slide.classList.toggle("is-active", i === index);
      slide.classList.toggle("is-before", i < index);
      slide.classList.toggle("is-after", i > index);
      slide.setAttribute("aria-hidden", i === index ? "false" : "true");
      // Keep off-screen slides out of the tab order so keyboard focus can't
      // land on an invisible video.
      slide.querySelectorAll("button, input, [tabindex]").forEach(function (el) {
        if (i === index) el.removeAttribute("tabindex");
        else el.setAttribute("tabindex", "-1");
      });
    });

    if (direction) scroller.dataset.direction = direction;

    if (previous >= 0) {
      var old = playerFor(slides[previous]);
      if (old) old.pause({ auto: true });
    }
  }

  /* The module clips do not start on their own: eight of them firing as you
     scroll was chaos, and each one is a deliberate thing to watch rather than
     atmosphere. They still stop themselves -- leaving a slide, or scrolling
     clear of the region, pauses whatever was playing so nothing carries on off
     screen. */
  var playbackKey = "";

  function syncPlayback(index, offScreen) {
    var key = index + ":" + offScreen;
    if (key === playbackKey) return;
    playbackKey = key;

    if (!offScreen) return;
    var current = playerFor(slides[index]);
    if (current) current.pause({ auto: true });
  }

  function measure() {
    // One viewport of scrolling per module, with the last one getting a full
    // viewport of dwell before the page moves on.
    scroller.style.setProperty("--slides", slides.length);
    fitSlides();
  }

  /* A pinned slide has exactly one screen, and its copy is written by hand --
     a couple of extra bullets, or a phone's toolbar eating a hundred pixels,
     and it would run under the timeline. Rather than tune the type for the
     longest module and hope, each slide is measured and scaled down only if it
     needs it. Almost always this is 1.

     Two passes with a reflow between: the first clears any previous scale so
     the natural height can be read, the second applies what is needed. */
  function fitSlides() {
    if (!pinned) return;

    var stage = scroller.querySelector(".curr-stage");
    if (!stage) return;

    var inners = slides.map(function (slide) {
      var inner = slide.querySelector(".curr-slide-inner");
      if (inner) inner.style.setProperty("--fit", "1");
      return inner;
    });

    var available = stage.clientHeight;
    void stage.offsetHeight; // flush the reset before measuring

    inners.forEach(function (inner, i) {
      if (!inner) return;
      var style = window.getComputedStyle(slides[i]);
      var padding =
        parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
      var needed = inner.getBoundingClientRect().height + padding;
      // A floor, so a runaway slide shrinks to illegibility rather than
      // silently: if it ever hits this, the copy is the thing to fix.
      var fit = Math.max(0.75, Math.min(1, available / needed));
      inner.style.setProperty("--fit", fit.toFixed(3));
    });
  }

  function update() {
    ticking = false;
    if (!pinned) return;

    var rect = scroller.getBoundingClientRect();
    // Same locked unit the region is sized in; see the note in index.html.
    var step = window.__vh || window.innerHeight;
    var travelled = -rect.top;
    var index = Math.floor(travelled / step);
    index = Math.max(0, Math.min(slides.length - 1, index));

    var direction = index > active ? "down" : "up";
    setActive(index, direction);

    scroller.classList.toggle("is-pinned", rect.top <= 0 && rect.bottom > step);

    // Scrolled clear of the region entirely: stop the video rather than leave
    // it playing and pulling segments off screen.
    syncPlayback(index, rect.bottom <= 0 || rect.top >= step);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  function enablePinned() {
    pinned = true;
    scroller.classList.add("is-scroller", "is-initialising");
    measure();
    active = -1;
    update();

    // Let the first frame settle with transitions suppressed, so the eight
    // slides don't visibly fade out of the stacked layout on load.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        scroller.classList.remove("is-initialising");
      });
    });

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
  }

  function onResize() {
    fitSlides();
    onScroll();
  }

  function disablePinned() {
    pinned = false;
    scroller.classList.remove("is-scroller", "is-pinned");
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);

    // Plain stacked list: every slide visible, every video minding itself.
    slides.forEach(function (slide) {
      var inner = slide.querySelector(".curr-slide-inner");
      if (inner) inner.style.removeProperty("--fit");
      slide.classList.remove("is-active", "is-before", "is-after");
      slide.removeAttribute("aria-hidden");
      slide.querySelectorAll("[tabindex='-1']").forEach(function (el) {
        if (el.classList.contains("pl-bar")) el.setAttribute("tabindex", "0");
        else el.removeAttribute("tabindex");
      });
      var player = playerFor(slide);
      if (player) player.watchViewport(true);
    });
    active = -1;
  }

  function apply() {
    if (pinnedQuery.matches) enablePinned();
    else disablePinned();
  }

  function jumpTo(i, opts) {
    // A deep link should land already there, not glide in from the top.
    var behavior = opts && opts.instant ? "auto" : "smooth";
    if (!pinned) {
      slides[i].scrollIntoView({ behavior: behavior, block: "start" });
      return;
    }
    window.scrollTo({
      // A pixel inside the band, not exactly on its edge: landing on the
      // boundary can floor to the week before.
      top: scroller.offsetTop + i * (window.__vh || window.innerHeight) + 2,
      behavior: behavior,
    });
  }

  // The timeline is the pagination now, and it lives outside this region
  // because it also has to appear over the hero. Hand it what it needs.
  if (window.Headroom) {
    window.Headroom.curriculum = {
      el: scroller,
      count: slides.length,
      jumpTo: jumpTo,
      isPinned: function () {
        return pinned;
      },
    };
  }

  // Left/right arrows step through weeks while the region is pinned.
  document.addEventListener("keydown", function (e) {
    if (!pinned || !scroller.classList.contains("is-pinned")) return;
    if (e.target.closest("input, textarea, .pl-bar, .player")) return;
    var delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    var target = Math.max(0, Math.min(slides.length - 1, active + delta));
    window.scrollTo({
      top: scroller.offsetTop + target * (window.__vh || window.innerHeight),
      behavior: "smooth",
    });
    e.preventDefault();
  });

  if (pinnedQuery.addEventListener) {
    pinnedQuery.addEventListener("change", apply);
  } else if (pinnedQuery.addListener) {
    pinnedQuery.addListener(apply);
  }

  // Players register on DOMContentLoaded; run after them.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
