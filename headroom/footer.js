/*
 * Footer: the acknowledgements underneath the page.
 *
 * The footer content lags slightly behind the scroll as the region comes up,
 * so the purple layer reads as being uncovered by the page above it rather
 * than arriving under its own power. The acknowledgements fade up one at a
 * time as they are reached, and stay.
 */
(function () {
  "use strict";

  var footer = document.getElementById("site-footer");
  if (!footer) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var items = Array.prototype.slice.call(footer.querySelectorAll(".thanks li"));

  /* ---------- Parallax on the way in ---------- */

  var ticking = false;

  function update() {
    ticking = false;
    var rect = footer.getBoundingClientRect();
    var vh = window.innerHeight;
    // 0 when the footer's top edge is at the bottom of the viewport, 1 once it
    // has risen a full screen further.
    var fp = Math.min(1, Math.max(0, (vh - rect.top) / vh));
    footer.style.setProperty("--fp", fp.toFixed(4));
    // Measuring seven list items every frame is wasted work while the footer is
    // still a screen away, and each read forces layout.
    if (rect.top < vh * 1.5) revealPassed();
  }

  /* Anything already scrolled past is shown outright. The observer below only
     fires on threshold crossings, and a jump straight to the bottom of the
     page crosses nothing -- the acknowledgements would sit there invisible,
     having gone from below the viewport to above it in one frame. */
  function revealPassed() {
    for (var i = items.length - 1; i >= 0; i--) {
      var li = items[i];
      if (li.classList.contains("is-in")) continue;
      if (li.getBoundingClientRect().bottom < 0) li.classList.add("is-in");
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  if (!reduceMotion) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ---------- Acknowledgements ---------- */

  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach(function (li) {
      li.classList.add("is-in");
    });
  } else {
    var itemObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          // Reveal on arrival, but also if it is already behind us: jumping
          // straight to the bottom of the page would otherwise leave the
          // acknowledgements permanently invisible, having never intersected.
          var passed = entry.boundingClientRect.bottom < 0;
          if (!entry.isIntersecting && !passed) return;
          entry.target.classList.add("is-in");
          itemObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.35, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach(function (li) {
      itemObserver.observe(li);
    });
  }
})();
