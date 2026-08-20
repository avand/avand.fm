/*
 * Course timeline.
 *
 * Oct 1 on the left, Nov 19 on the right, eight class dates between them. It
 * is the footer of the curriculum title and then the header of the week
 * slides -- one element that travels between the two, rather than a copy in
 * each, because a handoff between two copies shows a seam no matter how
 * carefully they are aligned.
 *
 * Where it sits is not this file's problem -- not any part of it. It is sticky
 * inside .curr-band, so flowing under the title, holding under the nav through
 * the weeks, and being pushed off by the last one are all the document's own
 * layout. Two earlier versions moved it from this scroll handler instead, and
 * both read as jitter on a phone for the same reason: scroll events do not keep
 * up with the compositor, so the bar was always chasing the content it was
 * meant to be attached to.
 *
 * What is left is the one thing layout cannot say: how far through the course
 * the reader is. The eight classes are the Thursdays from Oct 1 to Nov 19, so
 * week i sits at i/7 along the track, and weeks turn over every step of
 * scrolling -- curriculum.js owns that number. A cursor moving linearly with
 * scroll therefore arrives at each mark on the very scroll position where that
 * week's content swaps in: the movement is continuous, the content still
 * changes in steps.
 *
 * Everything written per frame is a custom property that CSS spends on a
 * transform. Two rects are read per frame -- this element's, to decide whether
 * the bar is built, and the region's, for progress -- but all reads happen
 * before any write, so a frame never interleaves them.
 */
(function () {
  "use strict";

  var el = document.getElementById("timeline");
  if (!el) return;

  /* Whether the browser can run the comet on the compositor. Where it can, the
     stylesheet drives both scroll-bound transforms from a scroll timeline and
     this file does not write --t at all -- the value would be recomputed every
     frame for two elements that had stopped reading it. */
  var COMPOSITED =
    window.CSS &&
    CSS.supports &&
    CSS.supports("animation-timeline", "scroll()");

  var marks = Array.prototype.slice.call(el.querySelectorAll(".tl-mark"));
  var nav = document.querySelector(".site-nav");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Drives the stagger of the build; the dots land left to right.
  marks.forEach(function (mark, i) {
    mark.style.setProperty("--i", i);
  });

  /* A dozen pixels per mark, thrown outward when the week fills.
   *
   * Built once and left alone: every particle's direction, distance, size,
   * duration and delay is baked into inline custom properties here, so firing
   * the burst later costs one class toggle and no JavaScript at all. Nothing
   * about it runs during a scroll.
   *
   * The angles are evenly spaced and then jittered, rather than random. Purely
   * random angles clump -- you get three pixels on top of each other and a bare
   * quadrant -- and a burst reads as a burst only when it goes out in every
   * direction. */
  /* The burst grows week by week. Week one gets none at all -- it fills as the
     reader arrives, before there is any sense of travel to celebrate, and a
     burst there would go off while they were still working out what they were
     looking at. From week two the count, the throw and the size all climb, so
     week eight finishes the course with something worth finishing on. */
  var sparksBuilt = false;

  function buildSparks() {
    if (reduceMotion || sparksBuilt) return;
    sparksBuilt = true;

    marks.forEach(function (mark, m) {
      if (m === 0) return;

      var growth = m / (marks.length - 1); // 1/7 at week two, 1 at week eight
      var count = Math.round(7 + growth * 13);
      var reach = 16 + growth * 20;
      var spread = 8 + growth * 16;

      var box = document.createElement("span");
      box.className = "tl-spark";
      box.setAttribute("aria-hidden", "true");

      for (var i = 0; i < count; i++) {
        var seed = Math.sin((m * 31 + i) * 12.9898) * 43758.5453;
        var rand = seed - Math.floor(seed);
        var angle = (i / count) * Math.PI * 2 + (rand - 0.5) * 0.45;
        // Measured from the centre of the mark, so it has to clear the ring
        // before it reads as a burst at all -- the dot's own radius is half of
        // --dot-size. Landing inside that just decorates the edge of the dot.
        var distance = reach + rand * spread;

        var pixel = document.createElement("i");
        if (i % 3 === 1) pixel.className = "is-cool";
        else if (i % 3 === 2) pixel.className = "is-hot";

        pixel.style.setProperty("--dx", (Math.cos(angle) * distance).toFixed(1) + "px");
        pixel.style.setProperty("--dy", (Math.sin(angle) * distance).toFixed(1) + "px");
        pixel.style.setProperty("--sz", (rand > 0.65 ? 3 + Math.round(growth * 2) : 3) + "px");
        pixel.style.setProperty("--sdur", Math.round(440 + growth * 200 + rand * 220) + "ms");
        pixel.style.setProperty("--sdel", Math.round(rand * 80) + "ms");
        box.appendChild(pixel);
      }

      mark.appendChild(box);
    });
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function curriculum() {
    return window.Headroom && window.Headroom.curriculum;
  }

  /* Two measurements, both for CSS to spend rather than for this file to act
     on. --nav-h is the sticky offset, since only CSS can hold the element
     there. --tl-space is where the bar's underside ends up once it is stuck,
     which is what the week slides pad their copy past: stating it as a measured
     fact means growing the bar -- numbering the dots, dropping the dates to a
     second row on a phone -- moves the copy down by itself, rather than the two
     drifting until a heading turns up underneath it.

     Written on load and on resize, never while scrolling. */
  var space = "";

  function measure() {
    var navHeight = nav ? nav.offsetHeight : 0;
    var root = document.documentElement.style;
    root.setProperty("--nav-h", navHeight + "px");

    /* Nothing below is meaningful while the bar is display:none -- offsetHeight
       is 0 and --tl-space would latch at just the nav's height, which is what
       the slides pad past. That happens for real: rotate a phone to landscape,
       the region stops pinning and the bar is hidden, the resize runs this, and
       rotating back never re-measures because the class is cleared inside a
       rAF. So bail, and let syncBuild call us once it is visible again. */
    if (!el.offsetHeight) return;

    /* Where the curriculum starts and where its last week arrives, in document
       pixels. This is the range the scroll timeline runs over, and it is the
       same span --t is computed from below -- one is the compositor's version
       of the other. Measured here, with the other measurements, rather than on
       every frame. */
    var curr = curriculum();
    if (COMPOSITED && curr && curr.step) {
      var from = curr.el.getBoundingClientRect().top + window.scrollY;
      root.setProperty("--tl-from", Math.round(from) + "px");
      root.setProperty(
        "--tl-to",
        Math.round(from + (curr.count - 1) * curr.step()) + "px"
      );
    }

    /* The sticky offset comes from the stylesheet rather than being restated
       here -- top is calc(var(--nav-h) + 18px), and --nav-h was just written,
       so this reads back the number CSS actually used. Two copies of 18 that
       had to stay equal is one too many. */
    var next = parseFloat(getComputedStyle(el).top) + el.offsetHeight + "px";
    if (next === space) return;
    space = next;
    root.setProperty("--tl-space", next);

    // The slides have just been given a different amount of room; whether any
    // of them has to be scaled to fit is now a different question.
    if (curr && curr.refit) curr.refit();
  }

  var activeIndex = -2; // -1 is a real state (no week reached yet)
  var ticking = false;
  var progress = null;
  var filledCount = -1;
  var running = null;

  /* Which way the reader is going. The build only ever runs on the way down --
     see syncBuild for why that is load-bearing rather than a nicety. */
  var lastY = -1;
  var goingDown = true;

  /* Which mark was tapped, while a jump is in flight. Tapping week seven from
     week two scrolls smoothly through five weeks, and each one of them arrives
     in turn -- so every one used to throw its burst on the way past. They are
     travel, not arrival; only the mark that was asked for is an arrival. */
  var jumpTarget = -1;
  var jumpTimer = 0;

  /* How many marks the comet has reached. Mark i sits at i/(count-1) along the
     track, so it is filled once progress has passed that -- which makes the
     whole state a single number, and the DOM worth touching only on the eight
     frames of a whole scroll where that number changes.

     This is deliberately a trigger and not a track. The fill used to be
     computed per mark from the scroll position on every frame, and inherited
     the scroll's own unevenness for its trouble; here the scroll picks the
     moment and CSS does the moving. */
  function setFilled(n) {
    if (n === filledCount) return;
    var previous = filledCount;
    filledCount = n;

    // Arrived where the tap asked for; ordinary scrolling resumes.
    if (jumpTarget >= 0 && n - 1 === jumpTarget) {
      clearTimeout(jumpTimer);
      jumpTarget = -1;
    }

    marks.forEach(function (mark, i) {
      mark.classList.toggle("is-filled", i < n);

      /* Only the week that has just been reached throws a burst, and only when
         the count is going up. Filling is a state -- arriving is an event, and
         they are not the same thing.
         
         The two came apart on a deep link. Landing on week five fills five
         marks in a single call, and the burst used to be declared on anything
         filled, so all five went off together the moment the build settled and
         the declaration started applying to them. Bursting the newest mark
         only makes arriving at a module by link look like arriving at it by
         scrolling, which is the point. */
      var asked = jumpTarget < 0 || i === jumpTarget;
      mark.classList.toggle("is-burst", i === n - 1 && n > previous && asked);
    });
  }
  function setActive(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    // No is-past here: the white fill is driven by setFilled, and the rules
    // that class used to carry were removed with the old dot markup.
    marks.forEach(function (mark, i) {
      mark.setAttribute("aria-current", i === index ? "true" : "false");
    });
  }

  function update() {
    ticking = false;

    var y = window.scrollY;
    if (y !== lastY) {
      if (lastY >= 0) goingDown = y > lastY;
      lastY = y;
    }

    if (!reduceMotion) syncBuild();

    var curr = curriculum();
    if (!curr) return;

    /* Nothing here to be the header of when the weeks are a stacked list --
       they carry their own headings, and the progress below would be measuring
       a pinned region that is not pinned. */
    var pinned = curr.isPinned();
    el.classList.toggle("is-off", !pinned);
    if (!pinned) {
      setActive(-1);
      setFilled(0);
      return;
    }

    /* A week costs a step, not a viewport -- curriculum.js decides how much of
       one. The cursor reaches the far end as the last week arrives, so the span
       is the seven steps between the first mark and the last. */
    var step = curr.step();
    var travelled = -curr.el.getBoundingClientRect().top;
    var span = (curr.count - 1) * step;

    /* Only when it has actually moved. --t is read by every mark on the bar to
       work out its own fill, so writing it invalidates a couple of dozen
       elements; writing the same value again invalidates them for nothing.
       Four decimals is finer than a pixel of travel, so this costs no
       precision -- it just drops the frames where the scroll did not move
       enough to matter, which on a phone is a lot of them. */
    var t = span > 0 ? clamp(travelled / span, 0, 1) : 0;

    /* Only when it has actually moved. --t positions the comet and the
       progress fill, both of which have to track the scroll; writing the same
       value again invalidates them for nothing. Four decimals is finer than a
       pixel of travel, so this costs no precision -- it drops the frames where
       the scroll did not move enough to matter. */
    if (!COMPOSITED) {
      var next = t.toFixed(4);
      if (next !== progress) {
        progress = next;
        el.style.setProperty("--t", next);
      }
    }

    setFilled(
      travelled >= 0 ? clamp(Math.floor(t * (curr.count - 1) + 1e-6) + 1, 0, curr.count) : 0
    );

    // The comet only exists once it has somewhere to be going.
    var moving = travelled >= 0 && t > 0.004;
    if (moving !== running) {
      running = moving;
      el.classList.toggle("is-running", moving);
    }

    // No week is active until one has actually been reached.
    setActive(
      travelled >= 0 ? clamp(Math.floor(travelled / step), 0, curr.count - 1) : -1
    );
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }

  function onResize() {
    measure();
    onScroll();
  }

  marks.forEach(function (mark, i) {
    mark.addEventListener("click", function () {
      var curr = curriculum();
      if (!curr) return;

      /* Held until the scroll lands on it, so the weeks it passes through stay
         quiet. The timer is the escape hatch: a smooth scroll that is
         interrupted, or one that stops a pixel short of the band, would
         otherwise leave every later burst suppressed for good. */
      jumpTarget = i;
      clearTimeout(jumpTimer);
      jumpTimer = setTimeout(function () {
        jumpTarget = -1;
      }, 2400);

      /* Let go of the week being left at the moment the build starts, not when
         the scroll finally arrives. aria-current is set from the scroll
         position, so the mark tapped away from kept its glow for the whole
         journey and only handed it over once the comet had landed -- which
         read as the old week still being the one on screen while the page was
         visibly on its way somewhere else. Nothing is current mid-flight;
         update() names the new one as it arrives. */
      if (i !== activeIndex) setActive(-1);

      curr.jumpTo(i);
    });
  });

  /* The build runs whenever the bar arrives and runs backwards whenever it
     leaves -- not once per page load. Built when it has settled into the upper
     part of the screen on the way down, which is about when the heading and its
     paragraph reach the middle; taken apart once it has dropped past 60% on the
     way back up, which is far enough from the bottom edge to actually watch.

     Measured here rather than by IntersectionObserver, which cannot express
     this. An observer reports threshold *crossings*, and two different lines
     mean a band between them -- 60% to 92% -- that the bar can be left sitting
     in after a teardown without ever crossing the build line again. Scrolling
     back down from inside that band produced no callback at all, so the bar
     stayed stripped to its line and comet for as long as the reader stayed in
     the curriculum. Comparing positions every frame has no such gap: the state
     is a function of where the bar is, not of which edges it happened to cross
     on the way there.

     The direction test matters just as much. Without it the teardown at 60% is
     immediately undone as the bar continues down past the build line on the
     same upward scroll -- the numbers animate back in while the reader is
     moving away from them. */
  var built = null;
  var settleTimer = 0;

  /* Long enough for the build to actually finish. 1223ms is when the last
     number *starts* -- it settles 300ms later, and the progress fill runs to
     1720ms behind it. Waiting only for the start is why the comet and the
     burst used to land over the tail of the sweep. Anything that belongs after
     the build waits for this rather than for .is-built, which is only the
     moment it begins. */
  var BUILD_MS = 1780;

  function setBuilt(next) {
    if (next === built) return;
    if (next) buildSparks(); // no-op after the first time
    built = next;
    el.classList.toggle("is-built", next);

    /* .is-settled is what tells the parts that are not part of the drawing --
       the comet, and the burst a filled week throws -- that the drawing is
       over. Without it, a reload with the scroll restored halfway through the
       course put both of them on screen immediately: the scroll position is
       already known on the first frame, so the comet had somewhere to be and
       four weeks were already full, while the line was still drawing itself
       and not one number had arrived. The build has to be allowed to finish
       before the state it is building gets to assert itself. */
    clearTimeout(settleTimer);
    if (next) {
      settleTimer = setTimeout(function () {
        el.classList.add("is-settled");
      }, BUILD_MS);
    } else {
      el.classList.remove("is-settled");
    }
  }

  function syncBuild() {
    var rect = el.getBoundingClientRect();

    /* A hidden bar measures as all zeros, and 0 <= 0.92 * viewport is trivially
       true -- which used to latch the build on in the stacked fallback and make
       it unreachable to tear down again, so a rotation back to pinned revealed
       a fully built bar with every week's burst going off at once. */
    if (!rect.height) return;

    // First time it has had a size: pick up the measurements it could not take.
    if (!space) measure();

    var vh = window.innerHeight;
    if (goingDown && rect.bottom <= vh * 0.92) setBuilt(true);
    else if (rect.top > vh * 0.6) setBuilt(false);
  }

  function init() {
    // Sparks are built on first use, not here: in the stacked fallback the bar
    // is hidden for the whole page and none of them would ever be seen.
    measure();
    if (reduceMotion) {
      // No sweep; it is simply there when it is wanted.
      el.classList.add("is-built", "no-build", "is-settled");
      built = true;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // The dates are set in a webfont, so the first nav measurement may be of
    // the fallback.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);

    /* Everything here reacts to scrolling, and a page can arrive already
       scrolled without a scroll event ever being fired -- a restored position
       on reload, or a deep link that jumps straight to a module. Re-measure and
       re-evaluate once the page has finished loading, or the bar sits
       undrawn until the reader happens to move. */
    window.addEventListener("load", onResize);
    update();
  }

  // Runs after player.js, hero.js and curriculum.js have registered.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
