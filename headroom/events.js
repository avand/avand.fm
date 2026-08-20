/*
 * Analytics: the one place that knows about Fathom.
 *
 * Two jobs. It loads Fathom, and it turns a `data-track` attribute into an
 * event -- so the ordinary case, "somebody pressed this thing", is markup
 * rather than a listener somebody has to remember to write.
 *
 *   <a href="#cta" data-track="headroom / hero / cta">Join a free class</a>
 *
 * data-track always holds a COMPLETE name, because this fires it as-is. The
 * video players carry data-track-prefix instead -- a stem that player.js
 * finishes with an action -- and this ignores that attribute entirely. If a
 * player root ever gets a plain data-track, every press of its play button
 * reports an event named after half of one.
 *
 * Loaded from the layout, so both the landing page and the concept pages get
 * it, and first in document order among the deferred scripts -- so window.Track
 * exists by the time player.js runs.
 *
 *
 * NAMES
 *
 * Fathom has no event properties and does not tell you which page an event
 * fired on. The name is the only dimension there is, so it has to carry all of
 * it. The scheme is location first, narrowing left to right:
 *
 *   <page path> / <section> / <element> [/ action]
 *
 * The action segment appears only where an element supports more than one --
 * a video plays, completes, and passes milestones, so it needs one; a link
 * only gets clicked, so it does not. Lowercase, kebab-case inside a segment,
 * " / " between them. Fathom sorts alphabetically, which is why the page path
 * leads: everything from one part of the site groups itself.
 *
 * A detail segment (a module slug, a week number) is allowed where the set of
 * values is small and closed. Never a value out of a 43-entry glossary, never
 * a URL, never anything a visitor typed -- those are already pageviews, and an
 * unbounded name list is a dashboard nobody reads.
 *
 *
 * WHY THIS FILE IS NOT CALLED analytics.js
 *
 * Because "/analytics.js" is on every ad blocker's filter list, and a blocked
 * file here would take window.Track down with it and throw from player.js.
 * The Fathom CDN is blocked in those browsers regardless -- that is their
 * choice and it works, the events simply never send -- but our own code should
 * not break in the process. Hence the name, and hence the `window.Track &&`
 * guard at every call site.
 */
(function () {
  /* The live site, and nothing else. bin/dev and the fm.avand.dev tunnel are
     the same build served from a different hostname, so an environment flag
     would be the wrong question -- and JEKYLL_ENV going missing in production
     would silently switch analytics off with nothing to notice it by. The
     hostname cannot go wrong that way. */
  var LIVE = location.hostname === "avand.fm";
  var SITE = "ITRXNPNT";

  /* Fathom's snippet has no stub queue: window.fathom does not exist until the
     script has loaded, and anything fired before then is simply lost. Since
     this file loads it, that window is real. Events wait here instead.

     Capped, and with a deadline. If Fathom never arrives -- blocked, offline,
     down -- the queue must not grow for the rest of the visit. */
  var PENDING_MAX = 20;
  var GIVE_UP_MS = 10000;
  var pending = [];
  var fired = {};
  var poll = null;
  var deadline = 0;

  function debug() {
    try {
      return localStorage.getItem("track-debug") === "1";
    } catch (e) {
      // Safari in private browsing throws on localStorage rather than
      // returning null.
      return false;
    }
  }

  function flush() {
    if (!window.fathom || !window.fathom.trackEvent) return false;
    while (pending.length) window.fathom.trackEvent(pending.shift());
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
    return true;
  }

  function event(name) {
    if (!name) return;

    if (!LIVE || debug()) {
      // The whole point of a local preview is being able to see this.
      if (window.console) console.info("[track] " + name);
      if (!LIVE) return;
    }

    if (flush()) {
      window.fathom.trackEvent(name);
      return;
    }
    if (pending.length >= PENDING_MAX) return;
    pending.push(name);

    if (!poll) {
      deadline = Date.now() + GIVE_UP_MS;
      poll = setInterval(function () {
        if (flush()) return;
        if (Date.now() > deadline) {
          clearInterval(poll);
          poll = null;
          pending.length = 0;
        }
      }, 250);
    }
  }

  function once(name) {
    if (!name || fired[name]) return;
    fired[name] = true;
    event(name);
  }

  window.Track = { event: event, once: once };

  /* Which part of the site this page is. Set by the layout; used to name
     outbound links that carry no attribute of their own. */
  function area() {
    return document.body.getAttribute("data-track-area") || "headroom";
  }

  function interactive(el) {
    return el.matches("a[href], button, summary, [role='button']");
  }

  /*
   * One listener for the whole page.
   *
   * data-track works on a container as well as on the control itself, which is
   * the difference between two attributes per concept page and forty. The
   * related-terms list carries one, and all four links inside it report; the
   * prose carries one, and every cross-reference in it does.
   *
   * A container only counts when the click actually landed on a link or a
   * button inside it, so a click on a heading in the middle of the prose is
   * not an event.
   */
  document.addEventListener(
    "click",
    function (e) {
      var target = e.target;
      if (!target || !target.closest) return;

      var tagged = target.closest("[data-track]");
      if (tagged) {
        var control = target.closest("a[href], button");
        if (interactive(tagged) || (control && tagged.contains(control))) {
          var name = tagged.getAttribute("data-track");
          if (tagged.hasAttribute("data-track-once")) once(name);
          else event(name);
          // Something that named itself is not also an unnamed outbound link.
          return;
        }
      }

      /* Anything leaving the site that nobody thought to label. A new external
         link starts reporting the day it is added, under the section it sits
         in, with no code change. */
      var link = target.closest("a[href]");
      if (!link || !/^https?:/i.test(link.getAttribute("href") || "")) return;
      var host = (link.hostname || "").replace(/^www\./, "");
      if (!host || host === location.hostname || /(^|\.)avand\.fm$/.test(host)) return;
      event(area() + " / outbound / " + host);
    },
    // Capture, so an event is recorded even where a handler further down calls
    // stopPropagation -- the modal's backdrop and the player's controls both do.
    true
  );

  /* Fathom itself, last: everything above is ready for it before it exists. */
  if (LIVE) {
    var s = document.createElement("script");
    s.src = "https://cdn.usefathom.com/script.js";
    s.defer = true;
    s.setAttribute("data-site", SITE);
    document.head.appendChild(s);
  }
})();
