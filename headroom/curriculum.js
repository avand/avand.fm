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
  // Whether the sticky stage currently holds the screen. Written by update(),
  // read by the dwell clock; see the note above arm().
  var onStage = false;

  /* How much scrolling one week costs, in viewports.
   *
   * A full viewport per week was the obvious first number and too much of
   * one: eight modules meant nine screens of scrolling to get through a
   * section that is really a list. Half a screen was better and still long;
   * three eighths is where it stopped feeling like work. Below about a third
   * the slides start changing faster than they can be read, so this is close
   * to the floor.
   *
   * Everything downstream is measured in this: the region's height in CSS,
   * which week is showing, where the arrow keys and the timeline's dots land,
   * and the pace of the timeline's cursor. It is the one number, so nothing
   * can be calibrated against a different one -- which is exactly how the
   * choreography and the distance came apart the last time.
   *
   * Not to be confused with the viewport itself, which still sizes the sticky
   * stage and still decides when the region is on screen. */
  var STEP = 0.375;

  function viewport() {
    // Same locked unit the region is sized in; see the note in index.html.
    return window.__vh || window.innerHeight;
  }

  function step() {
    return viewport() * STEP;
  }

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

    // The week turned over, so whatever the last one was waiting to report is
    // stale. See the dwell note below.
    arm();
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

  /* Which modules were actually reached.
   *
   * Everything else this section reports is a deliberate act -- a play, a
   * modal, a timeline dot -- and a week of traffic produced nine of them
   * across all eight modules. That number cannot tell a module nobody found
   * persuasive from one nobody laid eyes on, and those want opposite fixes.
   * This is the involuntary half: the module held the screen, whatever the
   * reader then did about it.
   *
   * The name is complete, in the markup, on the slide it belongs to, for the
   * same reason the players carry their own stems -- see the note above
   * Player.prototype.track. It is deliberately not data-track: that attribute
   * is a click name and events.js delegates it down through the subtree, so a
   * slide wearing one would report itself every time somebody pressed the
   * play button inside it.
   *
   * Once per page load. Scroll position is not a decision -- reading week 3
   * twice is one person who read week 3 -- so counting crossings would measure
   * gestures, and Fathom has no event properties, which makes that count the
   * only number the event carries. The set of names that fired is the finding:
   * reached m1, never reached m6.
   */
  function report(index) {
    var slide = slides[index];
    var name = slide && slide.getAttribute("data-track-view");
    if (name && window.Track) window.Track.once(name);
  }

  /*
   * A module counts once it has been stood on, not once it has been crossed.
   *
   * A week costs 0.375 of a viewport, so one flick of a trackpad passes
   * through three or four of them before the momentum runs out. Reporting on
   * arrival would credit every module between where a scroll started and
   * where it stopped, which is the same as reporting nothing: the deepest
   * module would be the most-seen one on the page.
   *
   * So arrival only starts a clock. If the same week is still showing when it
   * runs out, somebody is reading it; if the scroll moved on, the timer is
   * replaced by the next week's and the one that was passed through is never
   * reported. A second is long enough that momentum has always resolved and
   * short enough that it cannot outlast a genuine stop.
   *
   * Worth being clear about what this makes the number mean, because it is
   * not what a scroll-depth metric usually means: this counts modules dwelt
   * on, not modules scrolled past. Someone who blasts to the bottom of the
   * region reports the last module and nothing before it. That is the
   * intended reading -- "how far did people actually get" is a question about
   * attention, and a count of what flew by does not answer it -- but it does
   * mean these numbers are not comparable to a scroll-depth report.
   */
  var DWELL_MS = 1000;
  var dwell = null;

  function arm() {
    disarm();
    dwell = setTimeout(function () {
      dwell = null;
      /* Checked at the end rather than the beginning: the region can be armed
         while it is still below the fold. enablePinned runs update() once on
         load, and that first pass calls setActive(0) however far down the page
         the curriculum still is -- reporting on arm alone would credit module
         1 to every visitor, including the ones who bounced off the hero.

         This reads the flag update() already maintains for the is-pinned
         class. It is state this module owns, not a fresh measurement. */
      if (onStage) report(active);
    }, DWELL_MS);
  }

  function disarm() {
    if (dwell) clearTimeout(dwell);
    dwell = null;
  }

  /* The stacked fallback has no active slide to hang any of this on, and it is
     not a rare path: a phone held in landscape is under the 620px floor, and
     so is anybody who asked for reduced motion. Left uninstrumented, "nobody
     got to module 4" would be partly a statement about who was measured.

     An IntersectionObserver is the event this wants -- enter and leave arrive
     as callbacks, with no polling and no geometry read here -- and the dwell
     is the same idea per slide: entering starts a clock, leaving before it
     runs out cancels it. The heading is what is watched, not the slide, since
     unpinned a slide can be taller than a small screen and a fraction of the
     whole might never be met on the very devices this path exists for.

     Both paths end at the same once(), so switching modes on a rotate cannot
     double-count. */
  var watcher = null;
  var stacked = {};

  function watchStacked() {
    if (watcher || !window.IntersectionObserver) return;
    watcher = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var i = slides.indexOf(entry.target.closest(".curr-slide"));
          if (i < 0) return;
          if (!entry.isIntersecting) {
            clearTimeout(stacked[i]);
            delete stacked[i];
            return;
          }
          if (stacked[i]) return;
          stacked[i] = setTimeout(function () {
            delete stacked[i];
            report(i);
          }, DWELL_MS);
        });
      },
      { threshold: 0.5 }
    );
    slides.forEach(function (slide) {
      var head = slide.querySelector(".curr-head");
      if (head) watcher.observe(head);
    });
  }

  function unwatchStacked() {
    if (!watcher) return;
    watcher.disconnect();
    watcher = null;
    Object.keys(stacked).forEach(function (i) {
      clearTimeout(stacked[i]);
      delete stacked[i];
    });
  }

  function measure() {
    // A step of scrolling per module, with the last one getting a step of
    // dwell before the page moves on.
    scroller.style.setProperty("--slides", slides.length);
    scroller.style.setProperty("--step", STEP);
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

    /* Twice, because the answer changes the question. A scaled slide is laid
       out wider (see the max-width note in index.html) so that it comes back to
       the band's width once scaled -- and a wider column reflows the copy into
       fewer lines, which is a different height from the one just measured. One
       pass left the longest modules a few pixels over the bottom of the screen.
       The second pass settles it; a third has nothing left to move. */
    for (var pass = 0; pass < 2; pass++) {
      inners.forEach(function (inner, i) {
        if (!inner) return;
        var style = window.getComputedStyle(slides[i]);
        var padding =
          parseFloat(style.paddingTop || 0) + parseFloat(style.paddingBottom || 0);
        var scale = parseFloat(inner.style.getPropertyValue("--fit")) || 1;
        // getBoundingClientRect is post-transform; undo it to get the height
        // the copy actually wants at full size.
        var needed = inner.getBoundingClientRect().height / scale;
        /* The padding is subtracted from the room available, not added to what
           the copy needs. Only the inner is scaled -- the padding is not -- so
           dividing by (copy + padding) left the visible bottom at
           padTop + fit * copy, which overruns the stage whenever the padding is
           lopsided. It is: the top is --tl-space plus a little and the bottom is
           2em, so a slide scaled much below 0.8 used to run past the bottom of
           an overflow:hidden stage and cut the button off with no cue. */
        // A floor, so a runaway slide shrinks to illegibility rather than
        // silently: if it ever hits this, the copy is the thing to fix.
        var fit = Math.max(0.75, Math.min(1, (available - padding) / needed));
        inner.style.setProperty("--fit", fit.toFixed(3));
      });
    }
  }

  function update() {
    ticking = false;
    if (!pinned) return;

    var rect = scroller.getBoundingClientRect();
    var travelled = -rect.top;
    var index = Math.floor(travelled / step());
    index = Math.max(0, Math.min(slides.length - 1, index));

    /* These two are about the region being on screen, not about which week is
       showing, so they measure against the viewport -- the sticky stage is a
       whole one however little scrolling a week costs. */
    var vh = viewport();
    var holding = rect.top <= 0 && rect.bottom > vh;

    /* Taking the screen is the region's other state change, and the only one
       setActive cannot announce: scrolling into the curriculum from above
       arrives on week 1, which is already the active week, so setActive
       returns at its first line and no clock would ever start for module 1.
       Handled on the transition rather than per frame -- update() runs on
       every animation frame of every scroll, and re-arming from there would
       hold the dwell off forever. */
    if (holding !== onStage) {
      onStage = holding;
      scroller.classList.toggle("is-pinned", holding);
      if (holding) arm();
      // Scrolled clear of the region with a clock running: that module was
      // left, not read.
      else disarm();
    }

    var direction = index > active ? "down" : "up";
    setActive(index, direction);

    // Scrolled clear of the region entirely: stop the video rather than leave
    // it playing and pulling segments off screen.
    syncPlayback(index, rect.bottom <= 0 || rect.top >= vh);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  function enablePinned() {
    pinned = true;
    unwatchStacked();
    onStage = false;
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
    disarm();
    onStage = false;
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
    watchStacked();
  }

  function apply() {
    if (pinnedQuery.matches) enablePinned();
    else disablePinned();
  }

  /* Where the region starts, in document coordinates. Not offsetTop: that is
     measured from the offsetParent, so it silently changes meaning the day
     anything above this element gains a position of its own. */
  function regionTop() {
    return scroller.getBoundingClientRect().top + window.scrollY;
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
      top: regionTop() + i * step() + 2,
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
      // What a week costs in pixels, so the timeline paces its cursor against
      // the same distance this region is sized in rather than a second guess.
      step: step,
      // The timeline's height sets the slides' top padding, so it asks for a
      // re-fit once it knows what that height is.
      refit: fitSlides,
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
      top: regionTop() + target * step(),
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
