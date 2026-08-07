/*
 * Footer: the acknowledgements, and the reward at the end of them.
 *
 * Three things happen here.
 *
 * The footer content lags slightly behind the scroll as the region comes up,
 * so the purple layer reads as being uncovered by the page above it rather
 * than arriving under its own power.
 *
 * The acknowledgements fade up one at a time as they are reached, and stay.
 *
 * Then the still of Avand pointing at the camera shatters — it is a grid of
 * tiles, each showing its own slice of one photograph, so it reads as a single
 * image until the moment it doesn't — and the blooper reel is playing
 * underneath. It is meant to feel like the page breaking open rather than one
 * more section arriving, which is why it is triggered by continuing to scroll
 * past the thank-yous rather than by a play button.
 */
(function () {
  "use strict";

  var footer = document.getElementById("site-footer");
  var frame = document.getElementById("reward-frame");
  var shatter = document.getElementById("shatter");
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

  /* ---------- The break ---------- */

  if (!frame || !shatter) return;

  var COLS = 7;
  var ROWS = 5;

  function buildTiles() {
    var frag = document.createDocumentFragment();

    for (var row = 0; row < ROWS; row++) {
      for (var col = 0; col < COLS; col++) {
        var tile = document.createElement("div");
        tile.className = "shatter-tile";

        var w = 100 / COLS;
        var h = 100 / ROWS;
        tile.style.left = col * w + "%";
        tile.style.top = row * h + "%";
        // A hair of overlap, or seams show between tiles at some widths.
        tile.style.width = w + 0.3 + "%";
        tile.style.height = h + 0.3 + "%";

        // Each tile shows its own slice of the same photograph.
        tile.style.backgroundSize = COLS * 100 + "% " + ROWS * 100 + "%";
        tile.style.backgroundPosition =
          (COLS > 1 ? (col / (COLS - 1)) * 100 : 0) + "% " +
          (ROWS > 1 ? (row / (ROWS - 1)) * 100 : 0) + "%";

        // Thrown outward from the middle, so the picture bursts rather than
        // slides off in one direction.
        var cx = (col + 0.5) / COLS - 0.5;
        var cy = (row + 0.5) / ROWS - 0.5;
        var spread = 70 + Math.random() * 80;
        tile.style.setProperty("--dx", (cx * spread).toFixed(1) + "%");
        tile.style.setProperty("--dy", (cy * spread + 12).toFixed(1) + "%");
        tile.style.setProperty("--rot", (Math.random() * 50 - 25).toFixed(1) + "deg");
        // Middle first, edges last, so it reads as breaking outward.
        var distance = Math.sqrt(cx * cx + cy * cy);
        tile.style.transitionDelay = Math.round(distance * 260) + "ms";

        frag.appendChild(tile);
      }
    }

    shatter.appendChild(frag);
  }

  function play() {
    var player = window.Headroom && window.Headroom.get("bloopers");
    if (player) player.play({ muted: true });
  }

  var broken = false;

  function breakIt() {
    if (broken) return;
    broken = true;
    frame.classList.add("is-broken");
    play();
  }

  buildTiles();

  if (reduceMotion || !("IntersectionObserver" in window)) {
    // No shatter, but the reward still arrives: the still simply gives way.
    breakIt();
  } else {
    // Fires once the frame is properly on screen — which only happens if they
    // kept scrolling past the acknowledgements.
    var frameObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.intersectionRatio < 0.55) return;
          frameObserver.disconnect();
          // A beat of the still before it goes, so it registers as a picture
          // first and a video second.
          setTimeout(breakIt, 450);
        });
      },
      { threshold: [0, 0.55] }
    );
    frameObserver.observe(frame);
  }
})();
