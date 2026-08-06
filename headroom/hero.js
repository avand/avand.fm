/*
 * Hero stage choreography.
 *
 * The hero region is deliberately taller than the viewport, with a sticky
 * child holding one screenful in place. How far the page has scrolled into
 * that region becomes a single 0..1 progress value, published as --p, and CSS
 * does the rest: the copy lifts and fades, the background darkens and pushes
 * back, and the brand video rises from below to settle dead centre.
 *
 * Once it lands it stays there — the remaining height of the region scrolls
 * past while the sticky child holds the video centred — and that is when it
 * starts playing.
 *
 * Nothing here moves the scroll position or swallows scroll events. The page
 * scrolls exactly as fast as the reader asks; the region is just tall, and the
 * animation reads its offset.
 */
(function () {
  "use strict";

  var stage = document.getElementById("hero-stage");
  if (!stage) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The video arrives over the first viewport of scrolling; the rest of the
  // region is the dwell where it sits locked in place.
  function riseDistance() {
    return window.innerHeight;
  }

  function brand() {
    return window.Headroom ? window.Headroom.get("brand") : null;
  }

  /* Playback is decided from one place and keyed, so a scroll that fires every
     frame doesn't stack up play() calls — each one resolves an HLS attach
     asynchronously, and overlapping them races. */
  var playbackKey = "";

  function syncPlayback(shouldPlay) {
    var key = String(shouldPlay);
    if (key === playbackKey) return;

    var player = brand();
    if (!player) return; // players not registered yet; try again next frame

    playbackKey = key;
    if (shouldPlay) {
      if (!player.userPaused) player.play({ muted: true });
    } else {
      player.pause({ auto: true });
    }
  }

  var locked = false;
  var ticking = false;

  function update() {
    ticking = false;

    var rect = stage.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, -rect.top / riseDistance()));
    stage.style.setProperty("--p", p.toFixed(4));

    var nowLocked = p > 0.65;
    if (nowLocked !== locked) {
      locked = nowLocked;
      stage.classList.toggle("is-locked", locked);
    }

    // Play once it has actually arrived, and only while the stage is on screen.
    var onScreen = rect.bottom > 0 && rect.top < window.innerHeight;
    syncPlayback(p >= 0.98 && onScreen);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  function enable() {
    stage.classList.remove("is-static");
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  function disable() {
    // Reduced motion: a plain hero with the video below it, playing when it
    // comes into view like any other.
    stage.classList.add("is-static");
    stage.style.setProperty("--p", "1");
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onScroll);

    var player = brand();
    if (player) {
      player.autoplay = true;
      player.watchViewport(true);
    }
  }

  function apply() {
    if (reduceMotion.matches) disable();
    else enable();
  }

  if (reduceMotion.addEventListener) {
    reduceMotion.addEventListener("change", apply);
  } else if (reduceMotion.addListener) {
    reduceMotion.addListener(apply);
  }

  // Players register on DOMContentLoaded; run after them.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply);
  } else {
    apply();
  }
})();
