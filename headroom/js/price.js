/*
 * Holds the "How it works" price reveal until somebody is there to watch it.
 *
 * The reveal itself -- the rule drawn through $1,600, $800 wiping in behind
 * it, the comet tracing the launch-price pill -- is entirely in CSS, and the
 * hero runs the same block on load because the hero is on screen on load. The
 * second copy is several screens down. All this does is take the animations
 * away until the section arrives and then give them back.
 *
 * It is written as a hold that gets applied rather than one that gets
 * released, and that direction is deliberate: if this file fails to load, or
 * an engine has no IntersectionObserver, nothing is ever held and the reveal
 * plays on load exactly like the hero's. The reader misses a flourish. Nobody
 * is left looking at a price that stayed masked out waiting for an observer
 * that never came.
 */
(function () {
  "use strict";

  var targets = Array.prototype.slice.call(
    document.querySelectorAll("[data-reveal-on-view]")
  );
  if (!targets.length || !("IntersectionObserver" in window)) return;

  // Nothing to hold back for someone who asked not to be shown motion: the
  // stylesheet has already replaced the whole reveal with its end state, so
  // holding it would only be hiding a finished price.
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  targets.forEach(function (el) {
    el.classList.add("is-held");
  });

  /* When the block is on screen, and no later than that.

     This used to carry a -16% bottom inset as well, on the theory that a
     couple of lines of text arriving at the very bottom edge is not really
     "seen" yet. Measured, that fired with the block 79% of the way down the
     viewport -- and then the reveal waits out its own second of delay before
     the rule starts being drawn, by which time an ordinary scroll has carried
     the whole thing up past the middle of the screen. Two deliberate pauses
     in a row, and together they read as the thing being broken rather than
     patient.

     The delay is the one doing the waiting now. This just says the words are
     on screen.

     0.9 rather than 1: intersectionRatio is computed from rectangles that
     have been through a scroll offset and a device pixel ratio, and asking it
     to land exactly on 1.0 is asking for a rounding error to swallow the
     whole reveal on some particular screen. Nothing here needs the last
     tenth. */
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove("is-held");
        // Once. It is a reveal, not a loop -- coming back to it later should
        // find a price that has already been struck through.
        observer.unobserve(entry.target);
      });
    },
    { threshold: 0.9 }
  );

  targets.forEach(function (el) {
    observer.observe(el);
  });
})();
