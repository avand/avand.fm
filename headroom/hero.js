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

  var video = stage.querySelector(".hero-video");
  var introInner = stage.querySelector(".hero-intro-inner");

  /* How far below its centred position the curriculum heading has to sit to
     land a normal margin under the video. Measured rather than guessed: both
     heights depend on the viewport, and on how the copy wraps. */
  var sticky = stage.querySelector(".hero-sticky");

  function measureDock() {
    if (!video || !introInner || !sticky) return;

    var vh = window.innerHeight;
    // This is now the gap for the entire second move, not a moment in passing,
    // so it is set for comfort rather than for the tightest point.
    var margin = Math.max(64, vh * 0.1);

    // Where the heading actually comes to rest, measured with the transform
    // off. Deriving it from the viewport centre instead would be wrong: the
    // panel's padding is asymmetric, so its resting position is not the middle.
    stage.classList.add("is-measuring");
    var restTop =
      introInner.getBoundingClientRect().top - sticky.getBoundingClientRect().top;
    stage.classList.remove("is-measuring");

    var videoBottom = (vh + video.offsetHeight) / 2;
    var dock = Math.max(0, videoBottom + margin - restTop);

    stage.style.setProperty("--dock", Math.max(0, Math.round(dock)) + "px");
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

  /* The chevron takes you to where the video locks, which is exactly one
     viewport into the region -- the same place scrolling there by hand lands. */
  var chevron = document.getElementById("hero-chevron");

  function lockPosition() {
    return stage.offsetTop + riseDistance();
  }

  if (chevron) {
    chevron.addEventListener("click", function () {
      window.scrollTo({
        top: lockPosition(),
        behavior: reduceMotion.matches ? "auto" : "smooth",
      });
    });
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
    // The video holds for three quarters of a screen before the curriculum
    // starts arriving.
    var lock = vh * 0.75;
    var exit = vh;

    // The exit starts after the video has held for a beat, but never so late
    // that it couldn't finish before the region runs out.
    var exitStart = Math.min(rise + lock, Math.max(rise, travel - exit));

    var p = Math.min(1, Math.max(0, travelled / rise));
    var q = Math.min(1, Math.max(0, (travelled - exitStart) / exit));

    // Split the exit: the heading docks under the video over the first part,
    // then both move over the second. The dock is deliberately the shorter of
    // the two -- the heading arriving is a beat, the pair moving is the move.
    var DOCK_SHARE = 0.31;
    var q1 = Math.min(1, q / DOCK_SHARE);
    var q2 = Math.max(0, (q - DOCK_SHARE) / (1 - DOCK_SHARE));

    // How far into the intro's dwell we are, once it has finished arriving.
    // q saturates at 1 the moment the panel lands, so it cannot express
    // "a little beyond that" -- which is when the timeline is meant to build.
    var dwellStart = exitStart + exit;
    var dwellLength = Math.max(1, travel - dwellStart);
    var d = Math.min(1, Math.max(0, (travelled - dwellStart) / dwellLength));

    stage.style.setProperty("--p", p.toFixed(4));
    stage.style.setProperty("--q", q.toFixed(4));
    stage.style.setProperty("--q1", q1.toFixed(4));
    stage.style.setProperty("--q2", q2.toFixed(4));

    if (window.Headroom) window.Headroom.hero = { p: p, q: q, d: d };

    // Build the copy in once the intro is most of the way up, and leave it.
    if (q >= 0.55) revealIntro();

    var nowLocked = p > 0.65;
    if (nowLocked !== locked) {
      locked = nowLocked;
      stage.classList.toggle("is-locked", locked);
    }

    if (chevron) {
      var gone = p > 0.24; // matches the opacity ramp in the stylesheet
      if (gone !== chevron.hasAttribute("aria-hidden")) {
        if (gone) {
          chevron.setAttribute("aria-hidden", "true");
          chevron.setAttribute("tabindex", "-1");
        } else {
          chevron.removeAttribute("aria-hidden");
          chevron.removeAttribute("tabindex");
        }
      }
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

  function onResize() {
    measureDock();
    onScroll();
  }

  function enable() {
    stage.classList.remove("is-static");
    splitWords();
    measureDock();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    update();
  }

  function disable() {
    // Reduced motion: a plain hero with the video below it, playing when it
    // comes into view like any other.
    stage.classList.add("is-static");
    stage.style.setProperty("--p", "1");
    stage.style.setProperty("--q", "1");
    stage.style.setProperty("--q1", "1");
    stage.style.setProperty("--q2", "1");
    if (window.Headroom) window.Headroom.hero = { p: 1, q: 1, d: 1 };
    // No build-in: the copy is simply there.
    revealIntro();
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);

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
