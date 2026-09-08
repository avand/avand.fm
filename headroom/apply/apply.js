/*
 * The application wizard.
 *
 * Seven panels in the markup, one visible at a time. This file knows how many
 * there are by counting them, and knows what each one is called by reading
 * data-name off it -- so adding, removing or reordering a question is an edit
 * to index.html and nothing else. Nothing below hard-codes a question, a
 * count, or a position.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DRAFT IS SAVED AND THE ANSWERS ARE NOT POSTED UNTIL THE END
 * ---------------------------------------------------------------------------
 * Every answer goes into localStorage the moment it is given, and the whole
 * application goes to the Sheet once, on submit. Those are two different
 * problems and they want two different answers.
 *
 * A row per answer would mean a Sheet full of abandoned half-applications
 * with no way to tell them from finished ones, and doPost is append-only by
 * design -- it cannot go back and complete a row it wrote earlier, and the
 * whole security argument for a deployment open to "Anyone" rests on it never
 * reading one. So the Sheet gets whole applications or nothing.
 *
 * But somebody who answers three questions and closes the tab has done real
 * work, and asking them to do it again is how a second visit ends at the first
 * question. The draft is the answer to that, and it costs a browser API and no
 * server at all.
 *
 * The contact fields are deliberately NOT saved. The screen that collects
 * them is the last one, so there is nothing to resume, and leaving them out
 * keeps a stranger's name, email and phone number off their device -- which
 * is also the reason the privacy page has one sentence about this file and
 * not three.
 */
(function () {
  "use strict";

  var ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyiqhCLfyrsszqOGrbHxvIwqsAJvCPwzpW6o1FrN4pB2mwZslfeN2F57bcovuRDX-es/exec";

  var DONE_URL = "/headroom/apply/done/";

  /* The draft.
   *
   * Versioned in the key rather than in the value, so the day a question
   * changes shape the old drafts are simply not found instead of being read
   * by code that no longer understands them.
   *
   * Thirty days matches the __oppref click reference, which is the other
   * thing in this flow with a lifetime. Past that a resumed application is
   * somebody being shown answers they do not remember giving. */
  var DRAFT_KEY = "headroom.application.v1";
  var DRAFT_TTL = 30 * 24 * 60 * 60 * 1000;


  var form = document.getElementById("application");
  if (!form) return;

  var panels = [].slice.call(form.querySelectorAll(".apply-panel"));
  if (!panels.length) return;

  var bar = document.querySelector(".apply-progress-bar");
  var count = document.querySelector(".apply-count");
  var backBtn = document.querySelector(".apply-back");
  var exitLink = document.querySelector(".apply-exit");
  var status = form.querySelector(".apply-status");
  var submitBtn = form.querySelector(".apply-submit");
  var nextBtn = form.querySelector(".apply-next");
  /* Found as an element rather than as form.elements.words, because the name
     belongs to _data/application.yml now and renaming the free-text question
     there should not quietly stop its answer being saved. */
  var words = form.querySelector("textarea");

  var answers = {};
  var at = 0;
  var sending = false;

  /* -------------------------------------------------------------------------
     Storage
     -------------------------------------------------------------------------
     Every read and write is wrapped. Safari in private browsing throws on
     localStorage rather than returning null, and an application that cannot
     be filled in because a draft could not be saved is a far worse failure
     than one that simply does not remember. Everything here degrades to "no
     draft" and the form works unchanged. */

  function readDraft() {
    try {
      var raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return null;
      if (!draft.updated || Date.now() - draft.updated > DRAFT_TTL) {
        clearDraft();
        return null;
      }
      return draft;
    } catch (err) {
      return null;
    }
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          updated: Date.now(),
          at: at,
          answers: answers,
          // The ad reference, carried from the landing page and parked here so
          // it survives somebody closing the tab and coming back by typing
          // the URL. Without it a resumed application converts as organic.
          search: search,
        })
      );
    } catch (err) {
      /* No draft. The form still works. */
    }
  }

  function clearDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch (err) {}
  }

  /* -------------------------------------------------------------------------
     The ad reference
     -------------------------------------------------------------------------
     `oppref` and the utm parameters arrive on the landing page and are
     appended to the link that got somebody here. They have to reach
     /headroom/apply/done/, which is where the conversion is reported and where
     there is otherwise no query string at all -- see the note in events.js on
     fromAd(), and the one on the apply link in index.html.

     Preferring what is in the URL now over what a draft remembers: somebody
     who clicked a second ad is here on the second click, and that is the more
     recent fact. */
  var search = location.search;

  /* -------------------------------------------------------------------------
     Panels
     ------------------------------------------------------------------------- */

  function show(i, opts) {
    var previous = at;
    at = Math.max(0, Math.min(i, panels.length - 1));

    panels.forEach(function (panel, n) {
      panel.hidden = n !== at;
    });

    if (bar) bar.style.width = ((at + 1) / panels.length) * 100 + "%";
    /* Announced, not shown. The visible count was removed for reading as a
       price at the top of a form; a screen reader gets no progress at all
       from a bar that is aria-hidden, so it keeps the sentence.

       "Step", not "Question": the last panel asks for a name and a phone
       number, and calling that question seven of seven is the kind of small
       inaccuracy somebody notices at exactly the wrong moment. */
    if (count) {
      count.textContent = "Step " + (at + 1) + " of " + panels.length;
    }
    // Nowhere to go back to from the first panel, and a disabled control is a
    // worse answer than no control.
    if (backBtn) backBtn.hidden = at === 0;
    /* Next belongs only to a panel that cannot advance itself. Every other
       question advances when an option is tapped, and a Next button beside
       them would be a second way to do one thing.

       Submit belongs to exactly one panel, and the two are never shown
       together -- which is what lets both sit at the right of the same row
       with the same auto margin. Marked in the template rather than inferred
       from position, so neither depends on the contact screen staying last. */
    if (nextBtn) nextBtn.hidden = !panels[at].hasAttribute("data-advance");
    if (submitBtn) submitBtn.hidden = !panels[at].hasAttribute("data-submit");

    if (!opts || !opts.silent) {
      track("step-" + (at + 1));
    }

    /* Focus moves to the heading of the new panel, not to its first option.
       Landing on an option means a screen reader announces one answer and a
       keyboard user's next Enter picks it -- which is the wrong default when
       the question has not been read yet. tabindex="-1" makes the heading
       focusable without putting it in the tab order. */
    var heading = panels[at].querySelector(".apply-q");
    if (heading && previous !== at) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }

    /* The position is saved HERE, after it has changed, and that placement is
       the whole of a bug worth writing down.

       Every caller used to save before moving -- choose() recorded the answer
       and saved, then advanced a beat later; back() saved and then stepped
       back. So the stored `at` was always the panel being left rather than the
       one being shown, and a reload put somebody one question behind where
       they were. After Back it put them one ahead, which is the same bug
       wearing the other sign.

       Saving from inside show() means the stored position is whatever is on
       screen, by construction, and no caller has to remember the ordering.
       The callers still save on the way in, because an answer given and then
       abandoned inside the 260ms hold should survive too.

       Not saved when there is nothing to save: a visitor who opens the page
       and reads the first question should not be given a stored draft for it. */
    if (Object.keys(answers).length) saveDraft();
  }

  function advance() {
    if (at < panels.length - 1) show(at + 1);
  }

  /* -------------------------------------------------------------------------
     Answering
     ------------------------------------------------------------------------- */

  /* ADVANCING ON THE WAY UP, NOT ON THE CLICK, AND LIT ON THE WAY DOWN.
   *
   * There used to be two delays stacked here and neither was necessary. A
   * click fires after the finger lifts AND after the browser has decided the
   * gesture was a click; on top of that the answer was held lit for 260ms so
   * the choice would register before the question it belonged to disappeared.
   * Together they made a form that is six taps long feel like a form that is
   * thinking about it.
   *
   * pointerdown lights the option, which is the feedback the hold was there
   * to provide -- and it arrives sooner than the hold ever did, under the
   * finger, before it lifts. pointerup then advances with no wait at all.
   *
   * Not pointerdown for the advance itself, which is the tempting version. A
   * scroll that begins on an option fires pointerdown on it, so a swipe down
   * a panel that does not fit the screen would answer the question on the way
   * past. Scrolling fires pointercancel instead of pointerup, so this is the
   * earliest moment that is certainly a tap and not the start of a drag.
   *
   * The click listener stays for two audiences that never produce a
   * pointerup: somebody pressing Enter or Space on a focused option, and any
   * browser without pointer events. choose() bails when the option's panel is
   * no longer the one on screen, so the click that follows every pointerup is
   * a no-op rather than a second advance. */
  form.addEventListener("pointerdown", function (e) {
    var option = e.target.closest(".apply-option");
    if (option) light(option);
  });

  form.addEventListener("pointerup", function (e) {
    var option = e.target.closest(".apply-option");
    if (option) choose(option);
  });

  /* A drag or a scroll that started on an option: take the light back off,
     because nothing was chosen. */
  form.addEventListener("pointercancel", function (e) {
    var option = e.target.closest(".apply-option");
    if (option && answers[option.closest(".apply-panel").dataset.name] !== option.textContent.trim()) {
      option.classList.remove("is-chosen");
    }
  });

  form.addEventListener("click", function (e) {
    var option = e.target.closest(".apply-option");
    if (option) {
      choose(option);
      return;
    }
    if (e.target.closest(".apply-next")) {
      if (!answered()) return;
      record();
      saveDraft();
      advance();
    }
  });

  /* The light, on the way down. Visual only -- nothing is recorded and nothing
     advances, so a scroll that begins here costs a highlight and not an
     answer. */
  function light(option) {
    var panel = option.closest(".apply-panel");
    if (!panel || panel !== panels[at]) return;
    [].forEach.call(panel.querySelectorAll(".apply-option"), function (el) {
      el.classList.toggle("is-chosen", el === option);
    });
  }

  function choose(option) {
    var panel = option.closest(".apply-panel");
    /* Not merely "has a panel" -- has THE panel, the one on screen. Every tap
       produces a pointerup and then a click, and both reach here; this is what
       makes the second one a no-op instead of a second advance. It also
       retires a bug the old 260ms hold had, where two taps inside the hold
       armed two timers and the second fired from the next panel and skipped
       it. There is no timer now, so that cannot happen at all. */
    if (!panel || panel !== panels[at]) return;

    light(option);
    answers[panel.dataset.name] = option.textContent.trim();
    saveDraft();
    advance();
  }

  /* The one question that has to be answered, and the only place in this form
     that refuses to advance.
     
     It was skippable, on the theory that somebody who will not write a
     paragraph is still worth talking to. That is true of a mailing list and
     not of an application: this is the field that gets read before a call,
     the only screen that asks for any effort at all, and the moment somebody
     puts their own want into words -- which is what makes them care about the
     answer. An application with this blank is six taps.
     
     The bar is a non-empty answer and not a length. A minimum turns "too
     short" into a scold at the one screen where somebody is being asked to be
     candid, and anyone determined to type a full stop will, which is itself
     worth knowing.
     
     Whether this costs more than it collects is now visible rather than
     arguable: step-6 against step-7 in Fathom is exactly the number of people
     who reached this question and did not get past it. */
  function answered() {
    if (!panels[at].hasAttribute("data-advance")) return true;
    if (!words) return true;
    var error = panels[at].querySelector(".apply-error");
    if (words.value.trim()) {
      if (error) error.hidden = true;
      words.classList.remove("is-invalid");
      return true;
    }
    if (error) {
      error.textContent = "Even one sentence helps.";
      error.hidden = false;
    }
    words.classList.add("is-invalid");
    words.focus();
    trackError("missing-words");
    return false;
  }

  /* The free-text answer, read from the field rather than tracked as it is
     typed. */
  function record() {
    if (!words) return;
    var value = words.value.trim();
    if (value) {
      answers[words.name] = value;
    } else {
      delete answers[words.name];
    }
  }

  /* -------------------------------------------------------------------------
     Back and exit
     -------------------------------------------------------------------------
     Back is in-page state and not history, which is what was asked for. The
     cost of that choice is that the browser's own back gesture leaves the
     page -- and the draft is what makes that survivable: coming back lands on
     the question they left, with every answer still there. The two decisions
     only work as a pair. */

  /* The message has done its job the moment somebody starts fixing the field;
     leaving it up is telling them off while they comply. One listener on the
     form rather than three on the inputs, so a field added later is covered
     by having been added. */
  form.addEventListener("input", function (e) {
    var field = e.target;
    if (!field.closest || !field.closest(".apply-field")) return;
    field.classList.remove("is-invalid");
    var slot = fieldError(field);
    if (slot) slot.hidden = true;
  });

  if (words) {
    // The message has done its job the moment they start typing; leaving it
    // up would be telling somebody off while they comply.
    words.addEventListener("input", function () {
      var error = words.closest(".apply-panel").querySelector(".apply-error");
      if (error) error.hidden = true;
      words.classList.remove("is-invalid");
    });
  }

  if (backBtn) {
    backBtn.addEventListener("click", function () {
      record();
      saveDraft();
      track("back");
      show(at - 1);
    });
  }

  if (exitLink) {
    exitLink.addEventListener("click", function () {
      record();
      saveDraft();
      track("exit");
    });
  }

  /* -------------------------------------------------------------------------
     Submitting
     ------------------------------------------------------------------------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (sending) return;

    track("submit");
    /* The step this submission left from. Back is still live while a request
       is in flight, so `at` can have moved by the time a failure returns; the
       step it was sent from is the true answer, not wherever the reader is
       standing when it fails. */
    var sentFrom = at + 1;

    var name = form.elements.name.value.trim();
    var email = form.elements.email.value.trim();
    var phone = form.elements.phone.value.trim();

    /* One at a time, in field order, stopping at the first failure. Three
       messages at once is a page telling somebody everything they have done
       wrong; one is a page asking for the next thing. The field it is about
       is the field that just took focus, so there is never any question of
       which box the sentence belongs to.

       Cleared first, so nothing from a previous attempt is still on screen
       under a field this pass never reached. */
    clearFieldErrors();
    if (!fieldOk(form.elements.name, !!name, "What should I call you?", "missing-name")) return;
    if (
      !fieldOk(
        form.elements.email,
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
        "That email doesn't look right.",
        "invalid-email"
      )
    ) {
      return;
    }
    if (
      !fieldOk(
        form.elements.phone,
        !!phone,
        "I need a number to text you at.",
        "missing-phone"
      )
    ) {
      return;
    }

    /* Honeypot tripped -- accept quietly and send nothing.
     *
     * `false` because nothing was written: finish() otherwise parks the name
     * and email for the confirmation page, which fires Track.lead() and bills
     * a lead_created to the ad account. A conversion reported for a
     * submission the endpoint never stored is a campaign optimising toward
     * bots, and the ad side has no way to tell that row from a real one. */
    if (form.elements.company.value) {
      finish(false);
      return;
    }

    record();

    sending = true;
    busy(submitBtn, "Submitting…");

    /* The conversion id, minted here rather than at the moment the pixels fire.
     *
     * It is what deduplicates a conversion reported twice -- once from the
     * browser and once, if the Conversions API is ever wired up, from Apps
     * Script -- and the two halves can only collapse into one if they carry
     * the same string. Generated on the confirmation page, as it was, it
     * existed only in a browser that never told the server about it, so the
     * deduplication was a promise the code could not keep.
     *
     * Minted at submit, it goes to the endpoint in this payload and to the
     * confirmation page in the handover below, so both ends of the eventual
     * pair already agree. It also stops being a fact about a page view and
     * becomes a fact about an application, which is what it is meant to name.
     *
     * randomUUID needs a secure context, which production is and plain http
     * is not, hence the fallback -- the id only has to be unique, not
     * unguessable. */
    var conversionId =
      window.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : "apply-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);

    /* Reddit's click id, pulled off the query string that every link into this
       flow forwards. The browser's pixel reads it for itself; this copy is for
       the server-side report, which has no other way to know which ad brought
       somebody here -- Apps Script is handed no headers and no IP address, so
       without this the conversion it sends is close to anonymous. */
    var rdtCid = (search.match(/[?&]rdt_cid=([^&]*)/) || [])[1] || "";

    /* Reddit's own browser identifier, out of the cookie their pixel writes.
       Their API takes it as user.uuid and their example shows the shape --
       "1684189007728.7c73f2ae-..." -- so it is forwarded verbatim rather than
       parsed or hashed: it is their value going back to them.

       Only present for somebody the pixel ran for, which is somebody who
       arrived from a Reddit ad, which is the same population that has a click
       id. Two match keys for the same visitor rather than one. */
    var rdtUuid = (document.cookie.match(/(?:^|;\s*)_rdt_uuid=([^;]*)/) || [])[1] || "";

    var payload = {
      kind: "application",
      conversionId: conversionId,
      rdtCid: decodeURIComponent(rdtCid),
      rdtUuid: decodeURIComponent(rdtUuid),
      name: name,
      email: email,
      phone: phone,
      source: "headroom-website",
      page: window.location.href,
    };
    Object.keys(answers).forEach(function (key) {
      payload[key] = answers[key];
    });

    /* No Content-Type header, deliberately, and this is the one thing that
       reliably breaks this integration.

       A cross-origin POST labelled application/json is not a "simple" request,
       so the browser sends an OPTIONS preflight first -- and Apps Script Web
       Apps do not answer OPTIONS. The preflight fails, the real request is
       never sent, and the script is never reached, so there is nothing in its
       execution log to find either. It presents as a CORS error against a URL
       that works perfectly when opened directly.

       A string body with no Content-Type is sent as text/plain, which is on
       the CORS safelist, so no preflight happens. The body is still JSON; it
       is just labelled as text, and signup.gs parses it by hand. Do not add a
       Content-Type header here. */
    fetch(ENDPOINT, { method: "POST", body: JSON.stringify(payload) })
      .then(function (res) {
        if (!res.ok) throw new Error("bad status " + res.status);
        return res.json();
      })
      .then(function (data) {
        // Apps Script answers 200 whatever happens; the verdict is in the
        // body. Treating the status line as the answer would send somebody to
        // a confirmation page for an application that was rejected.
        if (!data || !data.ok) throw new Error(data && data.error);
        finish(true, conversionId);
      })
      .catch(function () {
        sending = false;
        idle(submitBtn);
        /* No address in here, deliberately. This string is served to every
           visitor and to every crawler that reads the page, and an address in
           page source is an address in a list somebody sells. The site already
           routes contact through Instagram -- see about.html -- so there is no
           need to invent a second answer here.
           
           What it says instead is the more useful thing anyway: this is a
           transient failure, retrying is the fix, and the six answers behind
           them are on their device and will still be there. */
        say("That didn't go through — try again in a moment. Your answers are saved.", "err");
        trackError("network", sentFrom);
      });
  });

  /* The application landed.
   *
   * The draft goes first, so a browser that is slow to navigate cannot leave
   * a finished application sitting in storage to be resumed later.
   *
   * Name and email are handed to the confirmation page in sessionStorage,
   * because Track.lead() hashes them and the conversion is reported from
   * there. It has to be reported from there: Track.lead() is an async call
   * into a script loaded from an ad-tech CDN, and firing it here and
   * navigating immediately is the race the note on /headroom/sample/register
   * describes losing. sessionStorage rather than localStorage so it dies with
   * the tab, and the confirmation page clears it the moment it has used it.
   *
   * The query string goes with the navigation for the same reason it came in:
   * fromAd() has to be able to see the reference at the moment of conversion.
   */
  function finish(converted, conversionId) {
    clearDraft();
    if (converted === false) {
      window.location.href = DONE_URL + search;
      return;
    }
    try {
      /* The first name only, because that is what the pixel wants: OpenAI's
         field is first_name_sha256, and events.js normalises a name by
         stripping punctuation and whitespace -- so handing it "Avand Amiri"
         would hash "avandamiri" as a first name and match nothing. Splitting
         here rather than in events.js keeps that function doing one thing to
         whatever it is given. */
      window.sessionStorage.setItem(
        "headroom.applied",
        JSON.stringify({
          firstName: form.elements.name.value.trim().split(/\s+/)[0],
          email: form.elements.email.value.trim(),
          conversionId: conversionId,
        })
      );
    } catch (err) {
      /* The page still confirms; only the ad-side conversion is lost. */
    }
    window.location.href = DONE_URL + search;
  }

  /* Reports into the field's own message slot rather than into the status
     line at the foot of the panel, and takes focus, because it is only ever
     called for the one failure being shown. */
  function fieldOk(field, ok, message, event) {
    field.classList.toggle("is-invalid", !ok);
    var slot = fieldError(field);
    if (slot) {
      slot.textContent = ok ? "" : message;
      slot.hidden = ok;
    }
    if (ok) return true;
    trackError(event);
    field.focus();
    return false;
  }

  function fieldError(field) {
    var group = field.closest(".apply-field");
    return group ? group.querySelector(".apply-error") : null;
  }

  function clearFieldErrors() {
    [].forEach.call(form.querySelectorAll(".apply-field"), function (group) {
      var input = group.querySelector("input");
      var slot = group.querySelector(".apply-error");
      if (input) input.classList.remove("is-invalid");
      if (slot) slot.hidden = true;
    });
  }

  /*
   * A button that is doing something, and says so itself.
   *
   * The state used to live in two places: the button went disabled and a
   * separate line under it read "Sending…". Two elements describing one fact,
   * and the one carrying the words was at the foot of the panel rather than
   * under the thumb that had just pressed. The button says it now, and the
   * status line is left for the thing it is actually needed for -- a failure,
   * which is the only message here that is not about the control itself.
   *
   * `disabled` is what stops the second press, not a flag: a disabled button
   * emits no click at all, so the double-submit cannot reach any code to be
   * guarded against. The `sending` flag stays as the belt to that pair of
   * braces, for a submit that arrives some other way -- Enter in a text field
   * still submits a form whose button is disabled.
   *
   * The label is stashed on the element rather than in a closure so that this
   * works for any button, without each caller having to remember what its own
   * one said.
   */
  function busy(button, label) {
    if (!button || "idleLabel" in button.dataset) return;
    button.dataset.idleLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
    // Announced as busy rather than silently going dead: to a screen reader a
    // disabled control with no explanation is a control that vanished.
    button.setAttribute("aria-busy", "true");
  }

  function idle(button) {
    if (!button || !("idleLabel" in button.dataset)) return;
    button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }

  function say(message, kind) {
    if (!status) return;
    status.textContent = message;
    status.className = "apply-status" + (kind ? " " + kind : "");
  }

  /* The guard is not superstition: this file is same-origin, but ad blockers
     match on filenames, and events.js is exactly the sort of name they match.
     window.Track and nothing more -- the failure it guards is all-or-nothing,
     so there is no state where Track exists but event() does not. */
  function track(name) {
    if (window.Track) window.Track.event("headroom / apply / " + name);
  }

  /* Errors carry the step they happened on:
   *
   *     headroom / apply / step-7 / error / invalid-email
   *
   * Fathom's names are flat strings, so this is a sorting convention rather
   * than a hierarchy -- and that is the whole of what it buys. An error sorts
   * directly beneath the step-N it belongs to, so the funnel and the reasons
   * people fall out of it read as one list instead of two that have to be
   * matched up by hand.
   *
   * `step` is passed in where the error can outlive the panel it started on:
   * a submission is in flight for as long as the network takes, and Back is
   * still live while it is, so `at` may have moved by the time a failure
   * comes back. The step a request was sent from is the true answer there,
   * not wherever the reader happens to be standing when it fails.
   */
  function trackError(name, step) {
    track("step-" + (step || at + 1) + " / error / " + name);
  }

  /* -------------------------------------------------------------------------
     Start
     ------------------------------------------------------------------------- */

  var draft = readDraft();
  if (draft) {
    answers = draft.answers || {};
    if (!search && draft.search) search = draft.search;

    // Put the answers back on the buttons, so Back shows what was chosen
    // rather than an unanswered question. An option whose text no longer
    // matches anything -- because the copy was edited since -- simply does
    // not light up, and that question reads as unanswered, which it now
    // effectively is.
    panels.forEach(function (panel) {
      var saved = answers[panel.dataset.name];
      if (!saved) return;
      [].forEach.call(panel.querySelectorAll(".apply-option"), function (el) {
        if (el.textContent.trim() === saved) el.classList.add("is-chosen");
      });
    });
    if (words && answers[words.name]) words.value = answers[words.name];
  }

  /* A resumed application fires no step event for the panel it opens on. The
     person did not reach step 4 here -- they reached it last time -- and
     counting it again would inflate the middle of the funnel with people who
     were already past it, in a way nothing downstream could unpick.

     `resumed` is fired instead, and it is the only event on this page that is
     not part of the funnel. It is here because it is the one number that says
     whether saving drafts is worth the code that saves them.

     Nothing is said on screen about it. There was a line -- "Picking up where
     you left off" -- and it explained something the page does not need to
     explain: somebody who left in the middle and came back is not confused to
     find themselves in the middle. */
  var resuming = !!(draft && draft.at);
  show(draft ? draft.at || 0 : 0, { silent: !!draft });

  if (resuming) track("resumed");
})();
