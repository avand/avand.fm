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

  var items = Array.prototype.slice.call(footer.querySelectorAll(".thanks li"));

  if (reduceMotion || !("IntersectionObserver" in window)) {
    items.forEach(function (li) {
      li.classList.add("is-in");
    });
  } else {
    var itemObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-in");
          itemObserver.unobserve(entry.target); // once, then left alone
        });
      },
      { threshold: 0.35, rootMargin: "0px 0px -8% 0px" }
    );
    items.forEach(function (li) {
      itemObserver.observe(li);
    });
  }
})();
