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

  /* Split the intro copy into words so they can arrive one at a time. Done
     once, up front, so nothing is rebuilding DOM mid-scroll. */
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

  var revealed = false;

  function revealIntro() {
    if (revealed || !intro) return;
    revealed = true;
    intro.classList.add("is-revealed");
  }

  var locked = false;
  var ticking = false;

  function update() {
    ticking = false;

    var rect = stage.getBoundingClientRect();
    var vh = window.innerHeight;
    var travelled = -rect.top;

    // How far the sticky child stays pinned before the region runs out.
    var travel = stage.offsetHeight - vh;
    var rise = riseDistance();
    var lock = vh;
    var exit = vh;

    // The exit starts after the video has held for a beat, but never so late
    // that it couldn't finish before the region runs out.
    var exitStart = Math.min(rise + lock, Math.max(rise, travel - exit));

    var p = Math.min(1, Math.max(0, travelled / rise));
    var q = Math.min(1, Math.max(0, (travelled - exitStart) / exit));

    stage.style.setProperty("--p", p.toFixed(4));
    stage.style.setProperty("--q", q.toFixed(4));

    // The timeline needs to know how far the intro has arrived, since it
    // fades in with it.
    if (window.Headroom) window.Headroom.hero = { p: p, q: q };

    // Build the copy in once the intro is most of the way up, and leave it.
    if (q >= 0.55) revealIntro();

    var nowLocked = p > 0.65;
    if (nowLocked !== locked) {
      locked = nowLocked;
      stage.classList.toggle("is-locked", locked);
    }

    // Play once it has arrived, and stop once it is halfway out rather than
    // letting it run while it flies away.
    var onScreen = rect.bottom > 0 && rect.top < vh;
    syncPlayback(p >= 0.98 && q < 0.5 && onScreen);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  function enable() {
    stage.classList.remove("is-static");
    splitWords();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  function disable() {
    // Reduced motion: a plain hero with the video below it, playing when it
    // comes into view like any other.
    stage.classList.add("is-static");
    stage.style.setProperty("--p", "1");
    stage.style.setProperty("--q", "1");
    if (window.Headroom) window.Headroom.hero = { p: 1, q: 1 };
    // No build-in: the copy is simply there.
    revealIntro();
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
