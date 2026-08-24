/*
 * Analytics: the one place that knows which vendors this site reports to.
 *
 * Three jobs. It loads Fathom, it loads the OpenAI ads pixel, and it turns two
 * attributes into events -- so the ordinary cases, "somebody pressed this
 * thing" and "somebody got this far", are markup rather than listeners
 * somebody has to remember to write.
 *
 *   <a href="#cta" data-track="headroom / hero / cta">Join a free class</a>
 *   <section data-track-view="headroom / instructor">
 *
 * data-track fires on a click; data-track-view fires when the element has held
 * the screen for a moment. Both hold a complete name. See each one's own note
 * further down.
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
 * THE TWO VENDORS ARE NOT THE SAME KIND OF THING
 *
 * Fathom counts behaviour: what people did on the page, named by the scheme
 * below, and nobody is billed by the answer. The OpenAI pixel exists to tell
 * an ad account that money spent produced a signup -- it reports ONE thing,
 * `lead_created`, when the form succeeds.
 *
 * So they are gated differently, and deliberately:
 *
 *   - Fathom events fire from the landing page only. That rule stands.
 *   - The pixel initialises on every page under /headroom/, glossary entries
 *     included, but ONLY for a visitor who arrived from an ad. An ad may
 *     point at a glossary entry, and a page without the pixel is a click that
 *     can never be attributed -- so it cannot be landing-page-only. But it
 *     has no business running for anybody else, for reasons written out at
 *     fromAd(). Initialising fires no event either way.
 *
 * OpenAI's event names are a closed vocabulary from its docs and have nothing
 * to do with the scheme below. `lead_created` is a standard name, which is
 * what lets a campaign optimise bidding toward it; a custom name cannot be
 * used that way, which is why this does not invent one.
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

  /* The OpenAI ads data source for avand.fm, from Tools > Conversions in Ads
     Manager. Public by design -- it is in the page source of every site that
     runs one, and it identifies where a conversion goes, not who may send it. */
  var PIXEL = "3Qm9ZKQgcepVC4tBmdJnx3";

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

  window.Track = {
    event: event,
    once: once,
    lead: lead,
    settle: settle,
    unsettle: unsettle,
  };

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

  /*
   * ---------------------------------------------------------------------
   * Sections that report being reached
   * ---------------------------------------------------------------------
   *
   * data-track-view holds a complete name, the way data-track does, and fires
   * when the element has held the screen for a moment instead of when somebody
   * clicks it. Most of this page is read rather than used -- the instructor
   * copy has nothing to press -- so without this the only thing separating a
   * section nobody found convincing from one nobody scrolled to is a guess.
   *
   *   <section class="instructor-band" data-track-view="headroom / instructor">
   *
   * A moment, not a crossing. Arriving only starts a clock; if the section is
   * still on screen a second later somebody is reading it, and if the scroll
   * carried on past, the timer is cleared and nothing is reported. Flicking
   * from the hero to the footer should say that nothing was read, because
   * nothing was.
   *
   * Once per page load, through once(), for the reason every other viewport
   * name here uses it: scrolling back up to re-read a section is one person
   * who read it, and counting crossings would measure the scroll rather than
   * the reader.
   *
   * Half of the smaller of the element and the screen has to be showing. Not
   * half the element: a section taller than the viewport can never show half
   * of itself, and those are exactly the sections long enough to be worth
   * asking about. The threshold list is what gets the callback to fire often
   * enough to notice; the arithmetic below is what decides.
   */
  var VIEW_DWELL_MS = 1000;

  /*
   * The clock, exposed, because this page has two ways of deciding that
   * something is on screen and only one idea of what "reached" means.
   *
   * Out here, geometry answers it: an observer watches the element and the
   * rule below decides. Inside the pinned curriculum it cannot -- the eight
   * slides sit at one position and every one of them reads as visible at once
   * -- so curriculum.js answers it from scroll offset instead. What both need
   * after that is identical: start a clock, cancel it if the thing goes away,
   * report once if it does not. Two copies of that drifted apart the moment
   * anybody tuned one, and the two families of names would have quietly
   * stopped being comparable with nothing to notice it by.
   *
   * settle() is idempotent: calling it again while a clock is already running
   * keeps that clock rather than restarting it, so a second of settling is a
   * second however often the caller says so. That is what makes it safe to
   * call from a scroll handler.
   */
  function settle(el) {
    if (!el || el.__trackSettle) return;
    var name = el.getAttribute && el.getAttribute("data-track-view");
    if (!name) return;
    el.__trackSettle = setTimeout(function () {
      el.__trackSettle = null;
      once(name);
    }, VIEW_DWELL_MS);
  }

  function unsettle(el) {
    if (!el || !el.__trackSettle) return;
    clearTimeout(el.__trackSettle);
    el.__trackSettle = null;
  }

  function watchViews() {
    if (!window.IntersectionObserver) return;
    var marked = document.querySelectorAll("[data-track-view]");
    if (!marked.length) return;

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var el = entry.target;
          var screen = (entry.rootBounds && entry.rootBounds.height) || window.innerHeight;
          var reference = Math.min(entry.boundingClientRect.height, screen);
          var showing =
            entry.isIntersecting &&
            reference > 0 &&
            entry.intersectionRect.height / reference >= 0.5;

          if (showing) settle(el);
          else unsettle(el);
        });
      },
      { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );

    Array.prototype.forEach.call(marked, function (el) {
      /* The curriculum's eight slides carry this attribute and curriculum.js
         observes them itself, for the reason above settle(). They still report
         through the same clock; only the question of what counts as on screen
         is answered somewhere else. */
      if (el.closest && el.closest("#curr-scroll")) return;
      observer.observe(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchViews);
  } else {
    watchViews();
  }

  /*
   * ---------------------------------------------------------------------
   * The OpenAI ads pixel
   * ---------------------------------------------------------------------
   *
   * OpenAI's own snippet, kept in the shape they publish it so it stays
   * diffable against their docs. The one change is `debug`, which is hardcoded
   * true in the copy Ads Manager hands you -- here it follows the same
   * localStorage switch as everything else in this file.
   *
   * Unlike Fathom, this has a stub queue built in: `oaiq` exists the moment
   * this runs and buffers calls until the SDK arrives. So nothing above needs
   * the pending/deadline machinery Fathom needs, and a blocked SDK -- which is
   * likelier here, bzrcdn.openai.com being an ad-tech hostname that filter
   * lists hit far harder than Fathom's CDN -- costs a conversion rather than
   * throwing.
   */
  /*
   * Whether this visitor has anything to do with an ad.
   *
   * The pixel used to initialise for everyone, which was wrong in a way the
   * help-centre docs do not tell you and the minified SDK does: init sets
   * __obref, a random per-browser identifier with a ONE YEAR lifetime, for
   * every visitor regardless of where they came from. __oppref -- the click
   * reference, thirty days -- behaves as documented and is only written when
   * `oppref` is actually in the query string.
   *
   * So somebody arriving from Google to read a glossary entry about beat grids
   * was being given a year-long identifier by an advertising company they have
   * no relationship with. Nothing about that was needed to measure an ad.
   *
   * Gating on it costs nothing. The click reference outlives the landing page
   * by thirty days, so a returning ad-clicker still initialises, still has
   * their reference, and their conversion still attributes. What goes away is
   * every visitor who never saw an ad -- no identifier, no cookie, no request.
   */
  function fromAd() {
    return (
      /[?&]oppref=/.test(location.search) ||
      /(^|;\s*)__oppref=/.test(document.cookie)
    );
  }

  function loadPixel() {
    (function (w, d, s, u) {
      if (w.oaiq) return;
      var q = function () {
        q.q.push(arguments);
      };
      q.q = [];
      w.oaiq = q;
      var j = d.createElement(s);
      j.async = 1;
      j.src = u;
      var f = d.getElementsByTagName(s)[0];
      f.parentNode.insertBefore(j, f);
    })(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");

    /* Reads `oppref` off location.search and parks it in a first-party cookie.
       Note that the modal's close handler in index.html rebuilds the URL as
       pathname + search precisely so the query survives -- dropping `.search`
       from that line would not break anything visible, it would quietly end
       attribution for every ad click that opened a module. */
    window.oaiq("init", { pixelId: PIXEL, debug: debug() });
  }

  /* Lowercase, then strip whitespace and ASCII punctuation but keep accented
     characters -- OpenAI's normalisation rule for name fields, verbatim. Their
     rule for an email is only trim + lowercase, so it does not come through
     here: running a name's rule over an address would eat the @ and the dot. */
  function normalizeName(v) {
    return String(v || "")
      .toLowerCase()
      .replace(/[\s!-\/:-@\[-`{-~]/g, "");
  }

  function sha256(v) {
    /* crypto.subtle is secure-context only, so this is undefined over plain
       http on localhost -- one more reason the pixel is production-only. */
    if (!v || !window.crypto || !crypto.subtle || !window.TextEncoder) {
      return Promise.resolve(null);
    }
    return crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(v))
      .then(function (buf) {
        return Array.prototype.map
          .call(new Uint8Array(buf), function (b) {
            return ("0" + b.toString(16)).slice(-2);
          })
          .join("");
      })
      .catch(function () {
        return null;
      });
  }

  function eventId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "lead-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  /*
   * The conversion. One per successful signup, and the only event this file
   * sends OpenAI.
   *
   * `lead_created` because this is a lead form for a free class -- not
   * `registration_completed` (nobody creates an account) and not
   * `appointment_scheduled` (nobody picks a date). No amount and no currency:
   * a free class has no revenue, and OpenAI only requires a currency when an
   * amount is present.
   *
   * Called on SUCCESS, not on submit -- a submission that the Apps Script
   * rejects is not a lead, and an ad account optimising toward bids on a
   * number that includes failures will buy the wrong traffic.
   *
   * The hashed identifiers are belt-and-braces. OpenAI's automatic advanced
   * matching is on by default and reads recognisable form fields, which this
   * form has (type=email, autocomplete=email), so it would probably match
   * without any of this. Doing it by hand makes it deterministic and visible
   * in the console -- and the measure call is chained so that it still fires
   * if hashing throws. A conversion matched poorly beats no conversion.
   *
   * event_id is here for a server side that does not exist yet. If the Apps
   * Script ever posts the same conversion to OpenAI's Conversions API, it
   * sends this same id as its `id` and OpenAI keeps whichever arrived first
   * -- that is the whole dedup contract.
   *
   * Note what that will cost, because it is not visible from here: the id is
   * minted below, AFTER the form's fetch has resolved, so it does not exist at
   * the moment the POST goes out. Sending it to the Apps Script means minting
   * it at submit time instead and passing it in -- `lead(name, email, id)` --
   * alongside the `__oppref` cookie, which is first-party and readable from
   * document.cookie. Plus two columns in signup.gs and the API key in Script
   * Properties, never in this repo. Until then the id is browser-side only,
   * where it is harmless and does nothing.
   */
  function lead(name, email) {
    var id = eventId();

    if (!LIVE || debug()) {
      if (window.console) console.info("[track] openai lead_created " + id);
      if (!LIVE) return;
    }
    if (!window.oaiq) return;

    var addr = String(email || "").trim().toLowerCase();

    Promise.all([sha256(addr), sha256(normalizeName(name))])
      .then(function (h) {
        var user = {};
        if (h[0]) user.email_sha256 = h[0];
        if (h[1]) user.first_name_sha256 = h[1];
        /* User data attaches through init, not through measure -- OpenAI's
           docs are explicit that it is request-scoped. pixelId is omitted
           because only one pixel is on the page, which their docs allow. */
        if (h[0] || h[1]) window.oaiq("init", { user: user });
      })
      .catch(function () {})
      .then(function () {
        window.oaiq(
          "measure",
          "lead_created",
          { type: "customer_action" },
          { event_id: id }
        );
      });
  }

  /* The vendors themselves, last: everything above is ready for them before
     they exist. Both are live-site-only -- see LIVE at the top.

     Fathom loads for everybody, because it is a cookieless counter. The pixel
     loads only for people who arrived from an ad, on every page under
     /headroom/ -- an ad may point at a glossary entry, and a page without the
     pixel is a click that can never be attributed. See fromAd(). */
  if (LIVE) {
    var s = document.createElement("script");
    s.src = "https://cdn.usefathom.com/script.js";
    s.defer = true;
    s.setAttribute("data-site", SITE);
    document.head.appendChild(s);

    if (PIXEL && fromAd()) loadPixel();
  }
})();
