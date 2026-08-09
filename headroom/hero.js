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
 * the curriculum heading's words as it arrives.
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
   * The hidden state is applied from here rather than in the stylesheet: with
   * no JS the button should simply be present, not permanently invisible.
   */
  var heroCta = document.querySelector(".hero-content .btn-primary");
  var navCta = document.querySelector(".site-nav .cta-nav");

  if (heroCta && navCta && "IntersectionObserver" in window) {
    navCta.classList.add("is-managed");

    var ctaObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          navCta.classList.toggle("is-visible", !entry.isIntersecting);
        });
      },
      { threshold: 0 }
    );
    ctaObserver.observe(heroCta);
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

  function markSettled() {
    // timeline.js draws its line once the curriculum heading has arrived;
    // this is the one thing it still needs from here.
    if (window.Headroom) window.Headroom.hero = { introVisible: true };
  }

  if (intro) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      intro.classList.add("is-revealed");
      markSettled();
    } else {
      splitWords();
      var introObserver = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            intro.classList.add("is-revealed");
            markSettled();
            introObserver.disconnect();
          });
        },
        { threshold: 0.4 }
      );
      introObserver.observe(intro);
    }
  }
})();
