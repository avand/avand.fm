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
 * It also switches itself off where it would do more harm than good: on narrow
 * screens, and for anyone who asked for reduced motion. Both fall back to the
 * plain stacked list, with each video playing as it scrolls into view.
 */
(function () {
  "use strict";

  var scroller = document.getElementById("curr-scroll");
  if (!scroller) return;

  var slides = Array.prototype.slice.call(
    scroller.querySelectorAll(".curr-slide")
  );
  var rail = document.getElementById("curr-rail");
  var dots = rail ? Array.prototype.slice.call(rail.querySelectorAll("button")) : [];
  if (!slides.length) return;

  // Pinning needs room: a wide enough viewport for the two-column slide, and a
  // tall enough one that a slide fits without being clipped by the sticky
  // stage. Anything else gets the plain stacked list.
  var pinnedQuery = window.matchMedia(
    "(min-width: 901px) and (min-height: 620px) and (prefers-reduced-motion: no-preference)"
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

    dots.forEach(function (dot, i) {
      dot.setAttribute("aria-current", i === index ? "true" : "false");
    });

    if (previous >= 0) {
      var old = playerFor(slides[previous]);
      if (old) old.pause({ auto: true });
    }
  }

  /* Starting playback is deliberately not done in setActive.
     Player.play() is async — it resolves an HLS attach before the media
     element actually starts — so a synchronous pause issued straight after it
     lands first and then loses to the play that arrives later. Deciding
     playback in exactly one place, from the state the scroller is actually in,
     removes that race. Keyed so it only acts on a real change. */
  var playbackKey = "";

  function syncPlayback(index, offScreen) {
    var key = index + ":" + offScreen;
    if (key === playbackKey) return;
    playbackKey = key;

    var current = playerFor(slides[index]);
    if (!current) return;

    if (offScreen) current.pause({ auto: true });
    else if (!current.userPaused) current.play({ muted: true });
  }

  function measure() {
    // One viewport of scrolling per module, with the last one getting a full
    // viewport of dwell before the page moves on.
    scroller.style.setProperty("--slides", slides.length);
  }

  function update() {
    ticking = false;
    if (!pinned) return;

    var rect = scroller.getBoundingClientRect();
    var step = window.innerHeight;
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
    window.addEventListener("resize", onScroll);
  }

  function disablePinned() {
    pinned = false;
    scroller.classList.remove("is-scroller", "is-pinned");
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);

    // Plain stacked list: every slide visible, every video minding itself.
    slides.forEach(function (slide) {
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

  // Jumping straight to a week from the rail.
  dots.forEach(function (dot, i) {
    dot.addEventListener("click", function () {
      if (!pinned) {
        slides[i].scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      var top = scroller.offsetTop + i * window.innerHeight;
      window.scrollTo({ top: top, behavior: "smooth" });
    });
  });

  // Left/right arrows step through weeks while the region is pinned.
  document.addEventListener("keydown", function (e) {
    if (!pinned || !scroller.classList.contains("is-pinned")) return;
    if (e.target.closest("input, textarea, .pl-bar, .player")) return;
    var delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    var target = Math.max(0, Math.min(slides.length - 1, active + delta));
    window.scrollTo({
      top: scroller.offsetTop + target * window.innerHeight,
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
