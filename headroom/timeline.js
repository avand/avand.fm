/*
 * Course timeline.
 *
 * Oct 1 on the left, Nov 19 on the right, eight class dates between them. It
 * is the footer of the curriculum title and then the header of the week
 * slides — one element that travels between the two, rather than a copy in
 * each, because a handoff between two copies shows a seam no matter how
 * carefully they are aligned.
 *
 * Being fixed to the viewport is what makes that possible: the title lives in
 * the hero's sticky region and the weeks live in the curriculum's, and nothing
 * in normal flow can span both.
 *
 * The eight classes are the Thursdays from Oct 1 to Nov 19, so week i sits at
 * i/7 along the track. Weeks turn over every viewport of scrolling, so a
 * cursor moving linearly with scroll arrives at each mark on the very scroll
 * position where that week's content swaps in: the movement is continuous, the
 * content still changes in steps. The cursor reaches the far end as week eight
 * arrives and rests there through its dwell.
 *
 * Once the region releases, the timeline rides its bottom edge up and off
 * rather than hovering over whatever follows.
 */
(function () {
  "use strict";

  var el = document.getElementById("timeline");
  if (!el) return;

  var marks = Array.prototype.slice.call(el.querySelectorAll(".tl-mark"));
  var nav = document.querySelector(".site-nav");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Drives the stagger of the build; the line sweeps left to right and each
  // mark lands as it is passed.
  marks.forEach(function (mark, i) {
    mark.style.setProperty("--i", i);
  });

  var built = false;

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function curriculum() {
    return window.Headroom && window.Headroom.curriculum;
  }

  var activeIndex = -2; // -1 is a real state (no week reached yet)
  var ticking = false;

  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    marks.forEach(function (mark, i) {
      mark.setAttribute("aria-current", i === index ? "true" : "false");
      mark.classList.toggle("is-past", i < index);
    });
  }

  function update() {
    ticking = false;

    var curr = curriculum();
    if (!curr) return;

    // Progress is measured in the locked unit the curriculum is sized in;
    // placement uses the live height, so it sits correctly on screen whatever
    // the browser chrome is doing.
    var vh = window.__vh || window.innerHeight;
    var screenH = window.innerHeight;
    var rect = curr.el.getBoundingClientRect();
    var pinned = curr.isPinned();

    // Vertical position: 0 parks it at the foot of the viewport, where it
    // closes the curriculum title; 1 lifts it to the top, where it heads each
    // week. The curriculum region entering the viewport is exactly the
    // handoff, so its own offset drives the move, and its bottom edge later
    // carries it away again.
    var pos = pinned ? clamp((vh - rect.top) / vh, 0, 1) : 0;

    // Freshly computed every call -- this is what ongoing visibility keys
    // off, so it has to actually go false again once the reader scrolls back
    // up past the region.
    var onScreen = rect.top < vh && rect.bottom > 0;

    /* The build is a one-shot: once the curriculum heading has scrolled into
       view, the line draws itself left to right and the marks land behind it.
       hero.js's introVisible fires a moment earlier than onScreen (as soon as
       the heading arrives, before the pinned region itself is on screen), so
       it's included as an earlier trigger for the build -- but it's a flag
       that goes true once and stays true forever (the observer in hero.js
       disconnects itself after firing), which makes it wrong for anything
       that needs to un-set later. Visibility below uses onScreen alone for
       exactly that reason. */
    var introVisible = !!(window.Headroom.hero && window.Headroom.hero.introVisible);

    if (!built && (introVisible || onScreen)) {
      built = true;
      el.classList.add("is-built");
    }

    var visible;
    if (!built) {
      visible = 0;
    } else if (!pinned) {
      // Stacked list: the weeks carry their own headings, so bow out as they
      // arrive.
      visible = rect.top >= vh ? 1 : clamp(rect.top / vh, 0, 1);
    } else {
      // Present over the curriculum title and over the weeks; gone if they
      // scroll back up above it.
      visible = onScreen ? 1 : 0;
    }

    var travelled = -rect.top;
    var span = (curr.count - 1) * vh;
    var t = pinned && span > 0 ? clamp(travelled / span, 0, 1) : 0;

    // No week is active until one has actually been reached.
    var index =
      pinned && travelled >= 0
        ? clamp(Math.floor(travelled / vh), 0, curr.count - 1)
        : -1;

    var height = el.offsetHeight;
    var topY = (nav ? nav.offsetHeight : 0) + 18;
    var bottomY = screenH - height - 34;
    var y = bottomY + (topY - bottomY) * pos;

    /* Past the last week the region releases and its final slide scrolls away.
       The timeline goes with it rather than hovering over whatever comes next:
       once the region's bottom edge rises above the fold, the timeline rides it
       up and off, the way a sticky header stops sticking at the end of its
       section. */
    y += Math.min(0, rect.bottom - screenH);

    el.style.setProperty("--tl-y", Math.round(y) + "px");
    el.style.setProperty("--t", t.toFixed(4));
    el.style.setProperty("--tl-vis", visible.toFixed(3));
    el.classList.toggle("is-interactive", visible > 0.5);
    setActive(index);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  marks.forEach(function (mark, i) {
    mark.addEventListener("click", function () {
      var curr = curriculum();
      if (curr) curr.jumpTo(i);
    });
  });

  function init() {
    if (reduceMotion) {
      // No build; it is simply there when it is wanted.
      el.classList.add("is-built", "no-build");
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  // Runs after player.js, hero.js and curriculum.js have registered.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
