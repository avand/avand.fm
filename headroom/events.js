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

  /* The Reddit pixel id, from Ads Manager. Public in the same way PIXEL is: it
     names where a conversion goes, not who may send one.

     It appears twice below on purpose -- once in the script URL and once in
     init -- because that is what Reddit's own snippet does, and the loader is
     kept a transcription of that snippet rather than an improvement on it.
     An earlier draft of this file passed optOut and useDecimalCurrencyValues
     to init, which came from a third-party write-up and are not in the code
     Reddit hands you. */
  var REDDIT = "a2_jkuzsl3m9hke";

  /* The Meta pixel id, from Events Manager. Public on the same terms as the
     two above: it names where a conversion goes, not who may send one.

     Meta calls the conversion `Lead`, the same word Reddit uses, which is a
     coincidence of vocabulary and not a shared anything -- the two are sent
     by different scripts, matched on different fields, and counted in
     different dashboards. */
  var META = "1105029631861200";

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

  /*
   * Whether this visitor has anything to do with a Reddit ad.
   *
   * `rdt_cid` is the click id Reddit appends to the landing page URL, and it
   * is the same shape of question fromAd() asks about `oppref`: a page that
   * loads an ad vendor's script for somebody who never saw an ad is a page
   * handing an advertising company a new visitor for nothing.
   *
   * NO COOKIE OF OUR OWN, unlike the OpenAI check, and that is a real
   * difference worth knowing rather than an oversight. `__oppref` is a CLICK
   * reference -- written only when oppref was in the query -- so testing it
   * asks "did this browser once arrive from an ad", which is a fair question
   * to answer yes to thirty days later. Reddit's own cookie, `_rdt_uuid`, is
   * a per-browser identifier written for everybody the pixel runs for, so
   * testing it would be asking whether the pixel had already run, which is
   * circular: it would answer yes for anyone who ever loaded it once.
   *
   * The cost is that this only recognises a visit that still carries the
   * parameter. Inside the funnel that is every page, because every link into
   * /headroom/apply/ carries location.search forward -- see the note on the
   * apply link in index.html. What it does not cover is somebody coming back
   * days later by typing the URL, and the honest options there are a cookie
   * of our own or nothing. Nothing, for now.
   */
  function fromReddit() {
    return /[?&]rdt_cid=/.test(location.search);
  }

  /*
   * Whether this visitor has anything to do with a Meta ad.
   *
   * `fbclid` is the click id Facebook and Instagram append to the landing
   * page URL. Same question as the two above, same reason for asking it.
   *
   * THIS ONE TAKES A COOKIE FALLBACK AND fromReddit() DOES NOT, which is a
   * deliberate difference rather than an inconsistency. Meta writes two
   * cookies and only one of them is a fair thing to test:
   *
   *   `_fbc` is the CLICK reference -- written only when fbclid was in the
   *   URL. Testing it asks "did this browser once arrive from a Meta ad",
   *   which is the same question `__oppref` answers for OpenAI, and a fair
   *   one to still answer yes to weeks later.
   *
   *   `_fbp` is a per-browser id written for everybody the pixel runs for.
   *   Testing that would ask whether the pixel had already run, which is
   *   circular -- the same trap `_rdt_uuid` sets, which is why fromReddit()
   *   stays on the query string alone.
   *
   * The fallback only works because the first visit sets it up: fbclid is in
   * the URL, so the pixel loads, so Meta's script writes `_fbc`. A visitor
   * whose first click had the script blocked has no cookie and is not
   * recognised later, which is the same limitation fromAd() carries.
   */
  function fromMeta() {
    return (
      /[?&]fbclid=/.test(location.search) ||
      /(^|;\s*)_fbc=/.test(document.cookie)
    );
  }

  /*
   * Reddit's pixel, loaded on the same terms as OpenAI's: only on the live
   * site, only for somebody who arrived from one of their ads.
   *
   * The stub queue is Reddit's own, out of their published snippet -- rdt
   * exists and buffers from the moment this runs, so nothing fired before the
   * script lands is lost, and a blocked script costs the events rather than
   * throwing.
   *
   * PageVisit is fired here rather than left to the loader, because Reddit's
   * snippet fires it and ours has to do the same job: it is the pageview half
   * of the pair that a Lead is measured against.
   */
  function loadReddit() {
    (function (w, d) {
      if (w.rdt) return;
      var p = (w.rdt = function () {
        p.sendEvent ? p.sendEvent.apply(p, arguments) : p.callQueue.push(arguments);
      });
      p.callQueue = [];
      var t = d.createElement("script");
      /* The id is in the query string as well as in init. That is how Reddit
         ship it, and the two are not interchangeable -- the script URL is what
         their CDN keys on. */
      t.src = "https://www.redditstatic.com/ads/pixel.js?pixel_id=" + REDDIT;
      t.async = true;
      var f = d.getElementsByTagName("script")[0];
      f.parentNode.insertBefore(t, f);
    })(window, document);

    window.rdt("init", REDDIT);
    window.rdt("track", "PageVisit");
  }

  /*
   * Meta's pixel, on the same terms as the other two: live site only, and
   * only for somebody who arrived from one of their ads.
   *
   * The loader is a transcription of the snippet Meta hands you, for the same
   * reason Reddit's is -- an improvement on a vendor's loader is a thing to
   * debug at the moment attribution breaks, and the snippet is what their
   * support will ask you to compare against.
   *
   * NO <noscript> PIXEL, and its absence is the point. Meta's snippet ships
   * with an <img> fallback that fires for every visitor without JavaScript,
   * which would walk straight through the gate this function sits behind:
   * everyone who blocks scripts would be reported to Meta precisely because
   * they blocked scripts, ad click or not. The gate is the promise the
   * privacy page makes, so the fallback goes.
   *
   * PageView is fired here rather than left to the loader, matching Reddit's
   * PageVisit -- it is the half of the pair a Lead gets measured against.
   */
  function loadMeta() {
    (function (f, b, e, v, n, t, s) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");

    window.fbq("init", META);
    window.fbq("track", "PageView");
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
  /*
   * A lead, reported to every ad vendor that is listening.
   *
   * One call site on the site -- the confirmation page -- and it fans out
   * here, so a page that accepts an application does not have to know how
   * many advertising companies are being told about it. Adding a third is a
   * branch in this function and nothing else.
   *
   * `id` is shared between them on purpose. It is this browser's identifier
   * for this conversion, and handing the same one to both means a later
   * question about whether two dashboards are describing the same application
   * has an answer.
   */
  function lead(name, email, conversionId, phone) {
    /* Given by the caller wherever there is an application to name. eventId()
       is the fallback for a call site that has none -- it keeps the vendors
       fed, but an id invented here is known only to this browser, so nothing
       server-side can ever be matched against it. */
    var id = conversionId || eventId();

    if (!LIVE) {
      if (window.console) {
        console.info("[track] lead " + id + " -- not sent, this is not avand.fm");
      }
      return;
    }

    /* Reddit first, and on its own line, because the OpenAI half below returns
       early in two places. Sharing a function does not mean sharing a fate: a
       visitor with a blocked oaiq must still report to Reddit, and the version
       of this that called redditLead() after `if (!window.oaiq) return` would
       have tied one vendor's delivery to the other's script loading. */
    var sentReddit = redditLead(id, email, phone);
    var sentMeta = metaLead(id, email, phone, name);
    var sentOpenai = !!window.oaiq;

    /* WHAT THIS LOG IS FOR, AND THE BUG THAT PUT IT HERE.
     *
     * It used to print three lines before any vendor was called, naming all
     * three whatever happened next. Each half then returns early when its SDK
     * is absent -- and the SDK is absent for anyone who did not arrive from
     * that vendor's ad, which is most people and every manual test. So the
     * console said "meta Lead" while metaLead was returning on its first line,
     * and the only way to find out was to go looking in an ad dashboard for a
     * conversion that had never been sent.
     *
     * A log that reports what a function was about to attempt is worse than no
     * log: it is a silent failure wearing a receipt. So each half now says
     * whether its SDK was actually there, and "skipped" names the reason.
     *
     * Skipped is not an error. On a page nobody reached from an ad it is the
     * correct outcome and the gates are doing their job. It is only a fault
     * when you expected the pixel to be loaded, which is exactly the case a
     * test is checking. */
    if (debug() && window.console) {
      console.info("[track] lead " + id);
      console.info("  openai lead_created  " + (sentOpenai ? "sent" : "skipped -- oaiq not loaded"));
      console.info("  reddit Lead          " + (sentReddit ? "sent" : "skipped -- rdt not loaded"));
      console.info("  meta Lead            " + (sentMeta ? "sent" : "skipped -- fbq not loaded"));
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

  /*
   * The Reddit half of a lead.
   *
   * `Lead` is one of Reddit's standard event names, so it is passed as-is
   * rather than as a Custom event -- a standard name is what their optimiser
   * can bid toward.
   *
   * conversionId is the deduplication key. It matters more here than it looks
   * like it does: if the Conversions API is ever wired up server-side, the
   * same application will be reported twice, once from this browser and once
   * from Apps Script, and Reddit collapses the pair only when both carry the
   * same id. That is why eventId() is generated once in lead() and passed in
   * rather than made here.
   *
   * THE SECOND init IS NOT A MISTAKE. Reddit's advanced matching goes in the
   * init call, and at page load there is nobody to match -- the address only
   * exists once somebody has applied. So the pixel is initialised bare on the
   * way in and again here, with the identifier, immediately before the
   * conversion it belongs to. Calls queue in order.
   *
   * Raw, which is the opposite of the OpenAI half of this same function,
   * where the hashing is ours to do. Reddit's field reference takes
   * "{{Email address}}" and names no digest anywhere, so a hash here would
   * match nobody while looking careful. Their pixel may hash it in the
   * browser before it leaves; that is their business and not something to
   * describe in a privacy policy as though it were ours.
   *
   * The endpoint sends the same address server-side, and the two collapse on
   * the shared conversionId. Both halves report it because either one can be
   * the one that arrives: this can be blocked, and that cannot see an IP.
   */
  /* Returns whether it actually sent, so lead() can say so rather than assume
     it. False means the SDK was not on the page, which for a visitor who did
     not arrive from a Reddit ad is correct and expected. */
  function redditLead(id, email, phone) {
    if (!REDDIT || !window.rdt) return false;
    var match = {};
    var addr = String(email || "").trim().toLowerCase();
    if (addr) match.email = addr;
    /* Already E.164 by the time it gets here -- the application normalises it
       once, at submit, and hands the same string to this and to the endpoint.
       Empty when it could not be normalised with certainty, and an absent
       identifier beats a confidently wrong one. */
    if (phone) match.phoneNumber = phone;
    if (match.email || match.phoneNumber) window.rdt("init", REDDIT, match);
    window.rdt("track", "Lead", { conversionId: id });
    return true;
  }

  /*
   * The Meta half of a lead.
   *
   * `Lead` is one of Meta's standard event names, so it goes as-is rather
   * than as a custom event -- a standard name is what their optimiser can bid
   * toward. It is the same word Reddit uses, which is a coincidence of
   * vocabulary: different script, different fields, different dashboard.
   *
   * THE SECOND init IS NOT A MISTAKE, for the reason it is not one above.
   * Meta's advanced matching is an argument to init, and at page load there
   * is nobody to match -- the address only exists once somebody has applied.
   * So the pixel is initialised bare on the way in and again here, carrying
   * the identifiers, immediately before the conversion they belong to. Calls
   * queue in order, so the matching is in place before the Lead goes.
   *
   * Raw, like the Reddit half and unlike the OpenAI one. Meta's pixel takes
   * these plain; handing it a digest we made would give it something to hash
   * a second time, which matches nobody while looking careful. What their
   * script does between taking the address and sending it is theirs, and not
   * something to describe in a privacy policy as though it were ours -- which
   * is why the privacy page groups Meta with Reddit and says the address and
   * the number are handed over as they are.
   *
   * `em`, `ph` and `fn` are Meta's field names, not ours. First name only,
   * for the same reason the OpenAI half hashes a first name only: the field
   * means the given name, and a full name in it matches nobody.
   *
   * eventID -- capital I, capital D, and deliberately not spelled like
   * Reddit's conversionId or OpenAI's event_id. It is the deduplication key
   * for the Conversions API: if the Apps Script ever reports this same
   * application server-side, Meta collapses the pair only when both carry
   * this id.
   */
  /* Returns whether it actually sent -- see the note in redditLead. */
  function metaLead(id, email, phone, name) {
    if (!META || !window.fbq) return false;
    var match = {};
    var addr = String(email || "").trim().toLowerCase();
    if (addr) match.em = addr;
    /* Already E.164 -- normalised once at submit and handed to every vendor
       and to the endpoint as the same string. Empty when it could not be
       normalised with certainty, and an absent identifier beats a confidently
       wrong one. */
    if (phone) match.ph = phone;
    var first = String(name || "").trim().split(/\s+/)[0];
    if (first) match.fn = first.toLowerCase();
    if (match.em || match.ph || match.fn) window.fbq("init", META, match);
    window.fbq("track", "Lead", {}, { eventID: id });
    return true;
  }

  /* The vendors themselves, last: everything above is ready for them before
     they exist. All of them are live-site-only -- see LIVE at the top.

     Fathom loads for everybody, because it is a cookieless counter. Each
     pixel loads only for people who arrived from that vendor's ad, on every
     page under /headroom/ -- an ad may point at a glossary entry, and a page
     without the pixel is a click that can never be attributed. See fromAd(),
     fromReddit() and fromMeta().

     Three vendors and three gates, deliberately: somebody who clicked a
     Reddit ad is not reported to Meta, and the privacy page says so. */
  if (LIVE) {
    var s = document.createElement("script");
    s.src = "https://cdn.usefathom.com/script.js";
    s.defer = true;
    s.setAttribute("data-site", SITE);
    document.head.appendChild(s);

    if (PIXEL && fromAd()) loadPixel();
    if (REDDIT && fromReddit()) loadReddit();
    if (META && fromMeta()) loadMeta();
  }
})();
