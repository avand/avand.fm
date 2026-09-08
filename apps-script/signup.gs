/**
 * Headroom signup endpoint — Google Apps Script.
 *
 * A Google Sheet is the database. This script is deployed as a Web App, the
 * form on the site POSTs to its URL, and each submission becomes a row. No
 * third-party service, nothing to pay for, and no Google branding anywhere the
 * visitor can see.
 *
 * ---------------------------------------------------------------------------
 * DEPLOYING
 * ---------------------------------------------------------------------------
 * This file is the source of truth. Edit it here, then:
 *
 *   bin/apps-script deploy
 *
 * which uploads it, cuts a version, and moves the deployment the form posts to
 * onto that version. `bin/apps-script push` uploads without deploying, which
 * is worth knowing about mainly so that a push is not mistaken for a deploy:
 * the code in Google's editor changes and the live form keeps running the old
 * version, including in the execution log.
 *
 * Copying and pasting into the browser editor still works and is still how
 * this got here originally. It is now the way to lose work: the next push
 * overwrites it with whatever is in the repo, without asking.
 *
 * The Sheet is "Headroom CRM" -- SPREADSHEET_ID below. Every tab it writes to
 * is named in a constant below, and renaming one in the Sheet without changing
 * its constant breaks that form. Three of the four are created on first use if
 * they are missing; the signup tab deliberately is not, for the reason given
 * at SHEET_NAME.
 *
 * The deployment's own settings, made once and carried in appsscript.json:
 *      Execute as:      Me
 *      Who has access:  Anyone            <-- not "Anyone with Google account"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LETS STRANGERS WRITE WITHOUT LETTING THEM READ
 * ---------------------------------------------------------------------------
 * "Execute as: Me" is the whole trick. The Web App runs under the Sheet
 * owner's authority, so a visitor's browser never touches the Sheet itself and
 * never needs permission to -- it only reaches this script, which appends. The
 * Sheet's own sharing stays private; do not share it with "Anyone", or the URL
 * becomes readable and everything below is moot.
 *
 * "Who has access: Anyone" is what makes the script callable from a browser
 * with no Google login. The only reachable surface is what these two functions
 * do, so the exposure is that somebody who finds the /exec URL can append rows
 * -- which is what the form does anyway. They cannot read a row back: doPost
 * answers with nothing but ok/error, and doGet deliberately returns nothing at
 * all. Neither of them ever calls getRange or getValues to read a row.
 *
 * Those two are the whole reason a stranger's browser can write to a private
 * Sheet, so they are worth checking after any change to appsscript.json: a
 * deployment that comes back as "Anyone with a Google account" does not error,
 * it just quietly rejects every visitor who is not signed in.
 *
 * The claim above is about doPost and doGet, because those two are the whole
 * of what the /exec URL can reach. Other functions in this file do read rows
 * -- sendInvites_ reads the entire signup tab -- and that is not a hole in it:
 * they run from the editor, under the owner's account, and no request can
 * call them. What would open a hole is doPost calling one of them. See the
 * note on sendInvites_ before wiring anything up that way.
 *
 * One other thing in that manifest: timeZone is America/Denver, which is the
 * timezone the classes are scheduled in, not the one whoever is editing this
 * happens to be sitting in. It was Europe/Lisbon -- Apps Script takes the
 * value from wherever the browser was when the project was created, and never
 * revisits it.
 *
 * Nothing in this file depends on it. A Date appended to a Sheet is displayed
 * in the *Sheet's* timezone, not the script's, so the rows read the same
 * either way. It is the timezone a time-driven trigger fires on, which is what
 * makes it worth getting right before anything is scheduled out of here: a
 * reminder set for "the morning before the class" runs on this value.
 *
 * The Sheet's own timezone is a separate setting, in File > Settings, and
 * changing this one does not touch it.
 *
 * ---------------------------------------------------------------------------
 * WHY oauthScopes IS WRITTEN OUT
 * ---------------------------------------------------------------------------
 * Apps Script will work the scopes out from the code by itself, and that is
 * the usual way. It is not the way here, for two reasons found the hard way.
 *
 * Detection is quiet when it is wrong. Adding a MailApp call did not produce
 * an authorization prompt; the function ran, threw at the call, and the throw
 * was caught, so the editor reported a clean run that had done nothing. A
 * declared scope prompts because it is declared, not because something was
 * noticed.
 *
 * And detection grants whatever the code happens to imply, which for mail is
 * a lot. See below.
 *
 * gmail.send is what the sample class invite at the bottom of this file goes
 * out on. It was listed here before anything sent, deliberately, so that the
 * consent was already in place when it did.
 *
 * script.external_request is what UrlFetchApp needs, and it arrived the way
 * this comment predicts one does: the Reddit conversion call was written,
 * deployed, and then failed at the first attempt with "Specified permissions
 * are not sufficient to call UrlFetchApp.fetch". Nothing about writing the
 * code asked for the scope, and nothing warned that it was missing until
 * something tried to use it.
 *
 * Adding a scope means the account has to authorise the project again -- the
 * editor prompts on the next run. And any change to this manifest is worth
 * checking against the two settings above it: `access` reverting from
 * ANYONE_ANONYMOUS does not error, it just starts refusing every visitor who
 * is not signed in to Google.
 *
 * ---------------------------------------------------------------------------
 * SENDING AS headroom@avand.fm TAKES THE GMAIL API, NOT MailApp
 * ---------------------------------------------------------------------------
 * Mail from here has to come from headroom@avand.fm. It is a verified send-as
 * alias on the account this runs as, and there are three ways to use it. Two
 * of them do not work, and neither says so.
 *
 * MailApp.sendEmail takes a `from` option, it is documented, and it is
 * ignored. No error, no warning -- the mail simply goes out from the account's
 * primary address. Every send during a morning of testing looked successful
 * and none of them had the right sender. That is the failure to watch for: the
 * only thing that ever revealed it was reading the From line of a delivered
 * message.
 *
 * GmailApp.sendEmail does honour `from`, and wants https://mail.google.com/ --
 * read, send, and permanently delete anything in the mailbox -- to do it.
 * A signup confirmation does not need the keys to the mailbox.
 *
 * Gmail.Users.Messages.send takes a raw RFC 822 message, so the From header is
 * written here rather than substituted by anything, and it needs only
 * gmail.send: send, and no read of any kind. That is the one to use, and it is
 * why the Gmail advanced service is switched on in appsscript.json.
 *
 * A diagnostic worth keeping, if the sender ever looks wrong again:
 * Gmail.Users.Settings.SendAs.list("me") reports every alias with its
 * verificationStatus and treatAsAlias, which distinguishes a misconfigured
 * alias from an ignored From header. It needs gmail.settings.basic, so add
 * that scope for the duration and take it out again.
 *
 * ---------------------------------------------------------------------------
 * WHY THE FORM POSTS text/plain
 * ---------------------------------------------------------------------------
 * This is the one thing that reliably breaks this integration, so it is
 * written down in both halves of it.
 *
 * A cross-origin POST with Content-Type: application/json is not a "simple"
 * request, so the browser sends an OPTIONS preflight first. Apps Script Web
 * Apps do not answer OPTIONS -- there is no doOptions -- so the preflight
 * fails and the real request is never sent. The form looks broken, the console
 * says CORS, and the script itself is never reached, so there is nothing in
 * the execution log to find.
 *
 * text/plain is on the CORS safelist. A string body with no Content-Type
 * header set gets exactly that, no preflight happens, and the POST goes
 * straight through. The body is still JSON -- it is just labelled as text, and
 * parsed below by hand.
 */

/**
 * The "Headroom CRM" Sheet. Pinned by ID rather than reached through
 * getActiveSpreadsheet() so that this keeps writing to the right book even if
 * the script is ever copied, moved, or run standalone rather than bound.
 */
var SPREADSHEET_ID = "1NocCmYeAK2aqtpfxagIEvQCv7MV8VW0ZubOaO165Bz0";

/**
 * The tab signups append to, pinned by name.
 *
 * This was an empty string, which meant "whatever tab is first". That works
 * until somebody drags a tab to the front, at which point signups start
 * landing in it silently and correctly, as far as the script is concerned.
 * A name cannot be reordered.
 *
 * Not created if it is missing, unlike the requests tab below: a typo here
 * should fail loudly rather than quietly begin a second, empty mailing list
 * that nobody knows to look in.
 */
var SHEET_NAME = "Sample Class Leads";

/**
 * Columns, in order. Changing this changes new rows only -- ensureHeaders
 * writes the header row once, into an empty Sheet, and never again.
 *
 * The last one is state, not data the form collects, and it is what makes the
 * invite mail idempotent. See INVITE_COL below.
 */
var HEADERS = [
  "Timestamp",
  "First name",
  "Email",
  "Source",
  "Page",
  "Invited at",
];

/**
 * WHY THE SHEET IS THE QUEUE
 *
 * The invite mail is not addressed by row number and not addressed by a list
 * passed in from somewhere. Its recipients are a *query*: every row that has
 * an email, has not been mailed at that address before, and has not
 * unsubscribed since it signed up. Sending stamps "Invited at" with the time
 * it went.
 *
 * Row numbers were the obvious alternative and they are a trap -- a sort, an
 * inserted row, or a deleted one renumbers every row beneath it, so a number
 * captured in one run means somebody else in the next.
 *
 * One consequence worth naming, because it is the whole point: this makes the
 * three jobs the same job. Backfilling the people who signed up before any of
 * this existed, retrying the ones whose automatic send failed, and mailing
 * somebody who signed up ten seconds ago are all "run it again" -- the absent
 * stamp *is* the retry queue, so nothing has to remember what went wrong.
 *
 * Resending to one person is clearing their cell. There is no other way to
 * make this mail somebody twice, which is the property a key was wanted for
 * in the first place.
 */
var INVITE_COL = HEADERS.indexOf("Invited at") + 1;
var EMAIL_COL = HEADERS.indexOf("Email") + 1;
var NAME_COL = HEADERS.indexOf("First name") + 1;
var TIME_COL = HEADERS.indexOf("Timestamp") + 1;

/**
 * Privacy requests -- access, correction, deletion -- from the form on
 * /headroom/privacy/. They land on their own tab, created on first use, and
 * never in with the mailing list: somebody asking to be deleted is the
 * opposite of a signup, and a request sitting in the middle of the CRM is one
 * that gets missed.
 *
 * The form exists because the alternative is a mailto: link, and publishing an
 * address on a page is publishing it to every scraper that reads the page too.
 * The law wants a contact route that works, not specifically an inbox.
 */
var REQUEST_SHEET_NAME = "Privacy Requests";
var REQUEST_HEADERS = ["Timestamp", "Email", "Request", "Message", "Page"];

/**
 * Unsubscribes, from the form on /headroom/unsubscribe.
 *
 * ITS OWN TAB, AND NOT A CELL ON THE LEAD'S ROW, FOR ONE REASON
 *
 * Finding the lead's row means reading the signup tab, and doPost must never
 * read a row. That is the entire argument for why a deployment open to
 * "Anyone" is safe -- see the top of this file -- and an unsubscribe handler
 * that searched for a match would hand a stranger a membership oracle for a
 * private mailing list: type an address, watch whether it was found.
 *
 * Appending sidesteps it completely. doPost stays append-only, the answer is
 * "ok" whether or not the address was ever on the list, and sendInvites_ --
 * which runs from the editor, where reading is free -- does the matching when
 * it next goes to send something.
 *
 * It is also the only place an unsubscribe is recorded. There was briefly a
 * second one -- an "Unsubscribed" column on the signup tab, for the people who
 * reply to the mail rather than clicking the link -- and two records of the
 * same fact is one more than can be kept true. Somebody who replies gets a row
 * typed into this tab by hand, which is the same row the page would have
 * written.
 */
var UNSUB_SHEET_NAME = "Unsubscribes";
var UNSUB_HEADERS = ["Timestamp", "Email", "Page"];

/** What the form may ask for. Anything else is recorded as "other". */
var REQUEST_KINDS = ["copy", "correct", "delete", "other"];

/**
 * Applications, from the wizard on /headroom/apply.
 *
 * Its own tab for the same reason the two above have theirs: these rows are
 * read by a person deciding who to talk to, and a mailing list is read by a
 * script deciding who to mail. Mixing them means every query on either one
 * has to start by excluding the other.
 *
 * Created on first use, like the privacy and unsubscribe tabs and unlike the
 * signup tab. The argument at SHEET_NAME -- that creating hides a typo behind
 * a plausible-looking empty tab -- does not apply where the name exists once,
 * here, and is never typed anywhere else. What it buys is that the first
 * application cannot be lost to a setup step somebody forgot.
 */
var APPLICATION_SHEET_NAME = "Applications";

/**
 * The five multiple-choice answers, in the order they are asked and therefore
 * the order they appear as columns.
 *
 * THE QUESTIONS THEMSELVES LIVE IN _data/application.yml, IN THE SITE REPO.
 * This list is the other half of that file and has to be kept in step with
 * it: same keys, same order. They cannot be one list, because this file is
 * deployed to Google and that one is published to Pages -- two releases, and
 * the whole reason doPost has to stay backward compatible.
 *
 * A question added there and not here is collected from the applicant, posted
 * to this endpoint, and dropped without a word. The note at the top of that
 * file says so too, on the theory that whoever adds a question is reading
 * that one and not this one.
 *
 * Named here rather than written out twice because the header row and the
 * appended row have to agree, and two hand-maintained lists in the same order
 * is a bug waiting for somebody to insert a question in the middle. The
 * headers below are built from this, and so is the row in application().
 *
 * The keys are what the page posts. The labels are what a human reads at the
 * top of a column in the Sheet -- short, because the question is not in the
 * column and does not need to be: every answer this file stores is a whole
 * sentence that stands on its own.
 */
var APPLICATION_CHOICES = [
  { key: "stage", label: "Stage" },
  { key: "gear", label: "Gear" },
  { key: "goal", label: "Goal" },
  { key: "focus", label: "Focus" },
  { key: "commitment", label: "Commitment" },
];

var APPLICATION_HEADERS = ["Timestamp", "Name", "Email", "Phone"]
  .concat(
    APPLICATION_CHOICES.map(function (q) {
      return q.label;
    })
  )
  .concat(["In their words", "Source", "Page", "Conversion ID"]);

function doPost(e) {
  try {
    var payload = parseBody(e);

    // One endpoint, two forms. Absent kind means the mailing list, so the
    // signup form keeps working unchanged and older cached copies of the page
    // -- which send no kind at all -- are not broken by this.
    var kind = String(payload.kind || "");
    if (kind === "privacy") return privacyRequest(payload);
    if (kind === "unsubscribe") return unsubscribeRequest(payload);
    if (kind === "application") return application(payload);

    var name = String(payload.firstName || "").trim();
    var email = String(payload.email || "").trim();

    // Same checks the page does, repeated here because the page's copy can be
    // skipped by anyone posting to this URL directly.
    if (!name) return json({ ok: false, error: "name required" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ ok: false, error: "email invalid" });
    }

    // The honeypot. Bots fill hidden fields in; people never see them. Answer
    // as though it worked, and write nothing.
    if (String(payload.company || "").trim()) return json({ ok: true });

    // Two submissions landing at once can each read the same last row and
    // write over each other -- and, into an empty Sheet, each write their own
    // header row. The lock is per-script, so the second one waits its turn.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return json({ ok: false, error: "busy" });

    var sheet;
    var rowNumber;
    try {
      sheet = targetSheet(SHEET_NAME);
      ensureHeaders(sheet, HEADERS);

      // Capped because nothing upstream of a public URL limits the length of
      // what arrives, and a cell holding a novel is a nuisance to clean up.
      //
      // Through cell() like every other write here. The signup form is gone
      // from the site, but this branch is not dead: it is the backward
      // compatibility the whole deploy-first rule exists to protect, and a
      // cached page can post here for as long as a browser holds it. A first
      // name typed as "-Ana" is a formula, and it lands as #ERROR!.
      sheet.appendRow([
        new Date(),
        cell(name.slice(0, 100)),
        cell(email.slice(0, 254)),
        cell(String(payload.source || "").slice(0, 200)),
        cell(String(payload.page || "").slice(0, 500)),
      ]);
      // Where that row landed. A position, not a value -- no row is read
      // here, and see sendInvites_ for why that distinction is load-bearing.
      rowNumber = sheet.getLastRow();
    } finally {
      lock.releaseLock();
    }

    // The mail goes out with the lock released. It is a network call to
    // Gmail, and holding a script-wide lock across one means the next person
    // to submit waits behind somebody else's SMTP.
    //
    // Wrapped, and deliberately not allowed to change the answer. The row is
    // already written; a person who signed up successfully must not be told
    // it failed because a send did. What a failure costs is the stamp, which
    // is exactly what makes sendSampleClassInvites() pick this row up later
    // -- the recovery is already built and needs nothing recorded here.
    //
    // The unsubscribe list is deliberately not consulted here. Somebody who
    // left and has now filled the form in again has resubscribed, and that is
    // the more recent of the two statements. Checking would also mean reading
    // a tab from doPost, which is the thing this file will not do.
    try {
      sendOneInvite_(name, email);
      stampInvited_(sheet, rowNumber, new Date());
    } catch (mailErr) {
      console.error(mailErr);
    }

    return json({ ok: true });
  } catch (err) {
    // Logged to the Apps Script execution log, not returned: an error message
    // from the inside of this is of no use to the page and of some use to
    // somebody probing it.
    console.error(err);
    return json({ ok: false, error: "server error" });
  }
}

/**
 * Nothing to see. The Sheet is not readable through this URL -- the only thing
 * the deployment can do is append.
 */
function doGet() {
  return json({ ok: true });
}

/** The body arrives as a JSON string labelled text/plain. */
function parseBody(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  // A form-encoded POST would land here instead, which is what a <form> with
  // no JavaScript would send. Accepting it costs one line and means the form
  // still works if the page's script never runs.
  return (e && e.parameter) || {};
}

/**
 * A privacy request. Only an email address is required -- it is the one thing
 * needed to answer -- and the message is optional, because "delete everything"
 * needs no elaboration.
 *
 * Deliberately never rejected for anything but a malformed address. A request
 * that bounces off a validation rule is a person who now believes this site
 * ignores them, which is precisely the failure the page promises will not
 * happen.
 */
function privacyRequest(payload) {
  var email = String(payload.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "email invalid" });
  }

  // Same honeypot as the signup form: answer as though it worked, write
  // nothing.
  if (String(payload.company || "").trim()) return json({ ok: true });

  var kind = String(payload.request || "").trim();
  if (REQUEST_KINDS.indexOf(kind) === -1) kind = "other";

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, error: "busy" });

  try {
    var sheet = targetSheet(REQUEST_SHEET_NAME, true);
    ensureHeaders(sheet, REQUEST_HEADERS);
    sheet.appendRow([
      new Date(),
      cell(email.slice(0, 254)),
      kind,
      cell(String(payload.message || "").slice(0, 2000)),
      cell(String(payload.page || "").slice(0, 500)),
    ]);
  } finally {
    lock.releaseLock();
  }

  return json({ ok: true });
}

/**
 * An unsubscribe. Appends and answers ok, always.
 *
 * Never rejected for anything but a malformed address, and never told that an
 * address was not found -- see UNSUB_SHEET_NAME for why that silence is
 * deliberate rather than lazy. An unsubscribe is also the one request where a
 * false "done" is safer than a true "you were not on the list": the second
 * answer sends somebody who mistyped away believing they are finished.
 */
function unsubscribeRequest(payload) {
  var email = String(payload.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "email invalid" });
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, error: "busy" });

  try {
    var sheet = targetSheet(UNSUB_SHEET_NAME, true);
    ensureHeaders(sheet, UNSUB_HEADERS);
    sheet.appendRow([
      new Date(),
      cell(email.slice(0, 254)),
      cell(String(payload.page || "").slice(0, 500)),
    ]);
  } finally {
    lock.releaseLock();
  }

  return json({ ok: true });
}

/* ===========================================================================
 * REDDIT'S CONVERSIONS API
 * ===========================================================================
 * The server-side half of the Reddit pixel. The browser reports a Lead from
 * /headroom/apply/done/; this reports the same one from here, and the two
 * collapse into a single conversion because both carry the same
 * conversion_id -- which is why the page mints that id at submit and sends it
 * along with the application rather than inventing one at the last moment.
 *
 * WHY BOTH, WHEN THE PIXEL ALREADY WORKS
 *
 * The pixel is a script loaded from an ad-tech hostname, which is the single
 * most blocked category of request on the web. This call leaves Google's
 * servers and cannot be blocked by anything on the applicant's machine. The
 * pixel is better at matching, this is better at arriving, and the
 * conversion_id is what makes running both cost nothing.
 *
 * THE TOKEN IS NOT IN THIS FILE AND MUST NOT BE
 *
 * This repo is public. The token lives in Script Properties, under
 * REDDIT_CAPI_TOKEN -- Project Settings > Script Properties in the editor.
 * Absent, redditConversion_ returns without sending, so the endpoint works
 * exactly as before and applications are unaffected.
 *
 * It is also worth knowing that Reddit's conversion token does not expire in
 * any useful sense: the one issued in September 2026 carries an exp of 2126.
 * There is no rotation to schedule, and equally nothing that will ever tell
 * you it has leaked.
 *
 * WHAT THIS CANNOT SEND, AND WHY
 *
 * The applicant's IP address. doPost is handed no headers and no remote
 * address -- Apps Script simply does not expose them -- so the ip/user-agent
 * pair that Reddit leans on when there is no click id is not available here.
 * What this has instead is the click id itself, forwarded by the page from
 * rdt_cid, and a hashed email. Where those exist the match is good; where
 * they do not, this event is close to anonymous and Reddit will say so by
 * matching very little of it.
 */
var REDDIT_PIXEL = "a2_jkuzsl3m9hke";
var REDDIT_CAPI = "https://ads-api.reddit.com/api/v3/pixels/" + REDDIT_PIXEL + "/conversion_events";

/**
 * Reports one conversion. Never throws: an application that was written to
 * the Sheet must not be reported as failed because an advertiser's API was
 * having a bad afternoon, which is the same rule sendOneInvite_ follows.
 *
 * Returns the HTTP status and body so that testRedditConversion below can
 * show what happened, and so a future caller could log it. Nothing acts on
 * the return value in the request path.
 */
function redditConversion_(payload, testId) {
  var token = PropertiesService.getScriptProperties().getProperty("REDDIT_CAPI_TOKEN");
  if (!token) return { skipped: "no REDDIT_CAPI_TOKEN in Script Properties" };

  var event = {
    /* Milliseconds. Reddit's example carries 1514764800000, thirteen digits;
       seconds would land every conversion in 1970 and nothing would say so. */
    event_at: Date.now(),
    /* UPPERCASE, and this was wrong for two deploys. "website" comes back
       "invalid action_source: website" -- a value error, not a field error,
       so the event is otherwise perfect and thrown away entire. */
    action_source: "WEBSITE",
    /* UPPER_SNAKE too. Reddit's example uses PAGE_VISIT, so the standard
       names are not the pixel's PascalCase ones. "Lead" was accepted by the
       validator, which is the worrying part: it 200s either way, and only
       the dashboard could tell you whether it landed as a Lead or as
       something unrecognised. */
    type: { tracking_type: "LEAD" },
  };

  /* Everything below is optional and sent only when the page supplied it, so
     an application arriving without any of it still produces a valid event
     rather than a rejected one. */
  var clickId = String(payload.rdtCid || "").trim();
  if (clickId) event.click_id = clickId.slice(0, 500);

  var page = String(payload.page || "").trim();
  if (page) event.event_source_url = page.slice(0, 1000);

  /* metadata.conversion_id is the deduplication key, and finding it took
     asking the API: conversion_id, event_id, dedup_id, deduplication_id,
     idempotency_key, id, external_id, event_metadata and custom_data all
     came back "unknown field". This is the same id the browser's pixel sends
     as conversionId, which is the only reason the two reports collapse into
     one conversion instead of counting an applicant twice. */
  var conversionId = String(payload.conversionId || "").trim();
  if (conversionId) event.metadata = { conversion_id: conversionId.slice(0, 100) };

  var user = {};

  /* THE ADDRESS, IN THE CLEAR, AND THAT IS THE DECISION RATHER THAN AN
   * OVERSIGHT.
   *
   * Reddit's user parameters take "{{Email address}}" -- the same placeholder
   * style as "{{IP address}}" and "{{Phone number}}", with no hashing named
   * anywhere -- so there is no version of this where they receive a digest
   * and still recognise anybody. Hashing it would have been a way of feeling
   * careful while sending a value that matches nothing.
   *
   * It is here because matching is not the only thing it buys. A conversion
   * Reddit can attach to a person is a conversion that tells them what kind
   * of person responds to these ads, which is what their optimiser bids on;
   * without it, every application is an anonymous tick and the campaign
   * learns nothing about who to find next.
   *
   * The price is that an advertiser holds the address, and the privacy page
   * says so plainly rather than describing it as scrambled -- which it is
   * for OpenAI, where the hashing is ours to do, and is not here.
   */
  var email = String(payload.email || "").trim().toLowerCase();
  if (email) user.email = email.slice(0, 254);

  /* Reddit's own browser identifier, out of the _rdt_uuid cookie the pixel
     writes, forwarded by the page. Their example shows the shape --
     "1684189007728.7c73f2ae-..." -- which is why this is passed through
     untouched rather than hashed like the address above: it is Reddit's own
     value being handed back to them. */
  var rdtUuid = String(payload.rdtUuid || "").trim();
  if (rdtUuid) user.uuid = rdtUuid.slice(0, 200);

  /* No ip_address and no user_agent, both of which Reddit accepts and both of
     which would help. doPost is handed neither -- Apps Script exposes no
     headers and no remote address -- and the page cannot tell us its own IP.
     The click id and the uuid are what this has instead. */
  if (Object.keys(user).length) event.user = user;

  var body = { data: { events: [event] } };
  /* A test run names itself, and Reddit keeps those out of the real numbers.
     Absent for a real application, so nothing in the request path is ever
     marked as a test. */
  if (testId) body.data.test_id = testId;

  var res = UrlFetchApp.fetch(REDDIT_CAPI, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });

  return { status: res.getResponseCode(), body: res.getContentText().slice(0, 500), sent: body };
}

/**
 * Lowercase hex SHA-256, which is the form every ad network wants a hashed
 * identifier in. Utilities.computeDigest returns signed bytes, hence the & 255.
 */
function sha256Hex_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var out = "";
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

/**
 * RUN THIS FROM THE EDITOR to check the whole conversion path without
 * touching the real numbers.
 *
 * `data.test_id` is Reddit's own facility for exactly this -- an event
 * carrying one is processed and kept out of reporting -- and it is why this
 * no longer has to be paid for in real conversions. Finding it took reading
 * their Node example; probing had looked for `test_mode`, which does not
 * exist, and concluded there was no test mode at all. A near miss on a field
 * name is indistinguishable from an absent feature when all you have is a
 * validator saying no.
 *
 * The values below are the shape a real application sends, so a 200 here
 * means the wiring is sound end to end. What it cannot tell you is whether
 * the email matched anybody, because a hash Reddit did not want still returns
 * 200 -- see the note in redditConversion_.
 */
function testRedditConversion() {
  var out = redditConversion_(
    {
      conversionId: "selftest-" + Date.now(),
      email: "selftest@example.com",
      rdtCid: "selftest-click",
      rdtUuid: Date.now() + "." + Utilities.getUuid(),
      page: "https://avand.fm/headroom/apply/?rdt_cid=selftest-click",
    },
    "headroom-selftest"
  );
  console.log(JSON.stringify(out, null, 2));
  return out;
}

/**
 * An application, from the wizard on /headroom/apply.
 *
 * WHY THIS VALIDATES THREE FIELDS AND NOTHING ELSE
 *
 * Name, email and phone are the three the page itself requires, repeated here
 * because the page's copy of a rule can be skipped by anyone posting to this
 * URL directly. The six answers are not checked at all -- not for presence,
 * not against the list of options they were picked from.
 *
 * Presence, because every question is skippable by design and a blank column
 * is a true record of somebody who did not answer. Rejecting one would throw
 * away the other eleven fields to punish a gap.
 *
 * The list of options, because this file would then hold a second copy of the
 * question copy, and the two would drift the first time a word in an answer
 * gets edited on the page. Everything stored here arrives as a whole sentence
 * from a fixed set of buttons; somebody who posts their own sentence instead
 * has written in a Sheet cell that a person reads, which is a nuisance and not
 * a hazard. The cap below is what keeps it to a nuisance.
 */
function application(payload) {
  var name = String(payload.name || "").trim();
  var email = String(payload.email || "").trim();
  var phone = String(payload.phone || "").trim();

  if (!name) return json({ ok: false, error: "name required" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "email invalid" });
  }
  if (!phone) return json({ ok: false, error: "phone required" });

  // Same honeypot as the other three: answer as though it worked, write
  // nothing.
  if (String(payload.company || "").trim()) return json({ ok: true });

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json({ ok: false, error: "busy" });

  try {
    var sheet = targetSheet(APPLICATION_SHEET_NAME, true);
    ensureHeaders(sheet, APPLICATION_HEADERS);

    // Built in the same three pieces as APPLICATION_HEADERS, from the same
    // list, so a question added in the middle moves the column and the value
    // together IN THIS FILE.
    //
    // The Sheet is the half that does not follow. ensureHeaders writes the
    // header row once, into an empty tab, and returns early ever after -- so
    // once the first application has landed, adding a question here widens
    // every new row against a header row that stays as it was, and every
    // value after the insertion point sits one column right of its label.
    // Silently, with old and new rows interleaved.
    //
    // Not fixed in code on purpose. Widening it would mean reading row 1 back,
    // and "doPost never reads a row" is the sentence the whole argument for a
    // deployment open to Anyone rests on; weakening it to save a manual step
    // is a bad trade. The manual step: add the column heading to the
    // Applications tab by hand, in the same position, before deploying. It is
    // written down again in _data/application.yml, which is the file somebody
    // adding a question is actually looking at.
    //
    // Every field capped, because nothing upstream of a public URL limits
    // what arrives. The free-text answer gets the same 2000 as a privacy
    // request's message; the choices get 200, which is comfortably more than
    // the longest option on the page and far less than a paragraph somebody
    // posted by hand.
    sheet.appendRow(
      [
        new Date(),
        cell(name.slice(0, 100)),
        cell(email.slice(0, 254)),
        cell(phone.slice(0, 40)),
      ]
        .concat(
          APPLICATION_CHOICES.map(function (q) {
            return cell(String(payload[q.key] || "").slice(0, 200));
          })
        )
        .concat([
          cell(String(payload.words || "").slice(0, 2000)),
          cell(String(payload.source || "").slice(0, 200)),
          cell(String(payload.page || "").slice(0, 500)),
          /* The id the page minted for this application, and gave to the ad
             pixels in the same breath. Stored so a row here and a conversion
             in an ad dashboard can be matched to each other -- a better join
             than utm_content, which identifies an ad rather than a person --
             and so the Conversions API has something to send when it is
             wired up, including on a retry. Last, with Source and Page,
             because it is machinery rather than anything to read. */
          cell(String(payload.conversionId || "").slice(0, 100)),
        ])
    );
  } finally {
    lock.releaseLock();
  }

  /* The conversion goes out with the lock released and after the row is
     written, and it cannot change the answer.
     
     Both halves of that matter. It is a network call to an advertiser, so
     holding a script-wide lock across it would make the next applicant wait
     behind Reddit; and an application that is safely in the Sheet must not be
     reported to the browser as failed because an ad API timed out. Same rule
     the sample class invite follows a few lines up, for the same reason.
     
     What a failure costs is one conversion, on a report the pixel has almost
     certainly already sent from the browser. */
  try {
    redditConversion_(payload);
  } catch (redditErr) {
    console.error(redditErr);
  }

  // No mail from here, unlike a signup. The confirmation an applicant gets is
  // the page they land on, and what happens next is a text message sent by a
  // person who has read what they wrote -- which is the entire premise of
  // asking them to apply rather than to join a list.
  return json({ ok: true });
}

/**
 * Every tab is found by name -- there is no "first tab" fallback left, on
 * purpose. `create` makes the tab if it is missing, which the requests,
 * unsubscribe and application tabs all pass, and which the signup tab must not
 * have, for the reason given at SHEET_NAME.
 */
function targetSheet(name, create) {
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  // A name that matches nothing would otherwise return null and fail deeper
  // in, on a stack that says nothing about the actual mistake.
  // getSheetByName is case-sensitive, which is worth knowing before renaming
  // a tab: "Privacy requests" and "Privacy Requests" are different tabs.
  var sheet = book.getSheetByName(name);
  if (!sheet && create) sheet = book.insertSheet(name);
  if (!sheet) throw new Error('No tab named "' + name + '"');
  return sheet;
}

/** Write the header row once, on the first submission into an empty sheet. */
function ensureHeaders(sheet, headers) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

/**
 * A value safe to put in a cell.
 *
 * WHY THIS EXISTS: A PHONE NUMBER CAME BACK AS #ERROR!
 *
 * Sheets decides a cell is a formula from its first character, and it does so
 * for values written by a script exactly as for values typed by a person.
 * "+1 555 0100" is a formula. So is anything starting with =, -, or @.
 *
 * The first application ever posted at this endpoint wrote "#ERROR!" into the
 * Phone column, which is the one field whose entire purpose is being able to
 * text somebody back. autocomplete="tel" fills international numbers in
 * exactly that shape, so this was not an edge case; it was most of them.
 *
 * Prose is at risk too, and less obviously: an answer that begins "- " is a
 * subtraction, and a list is a natural way to answer "what do you want to be
 * able to do".
 *
 * A leading apostrophe is Sheets' own escape for "this is text". It is
 * consumed on write and never appears in the cell or in anything read back
 * out of it, so the stored value is the one somebody typed.
 *
 * The same escape also closes CSV injection, which is the other reason to do
 * this at the boundary rather than per field: a cell holding
 * =IMPORTXML(...) is a formula that runs when this Sheet is exported and
 * opened somewhere else, under whoever opens it.
 */
function cell(value) {
  var text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* ===========================================================================
 * THE SAMPLE CLASS INVITE
 * ===========================================================================
 * The signup form's button says "Send me the dates". This is what sends them.
 *
 * It goes out twice from two directions and they are the same mail, built by
 * the same function, so the two cannot drift:
 *
 *   - automatically, from doPost, to somebody who just signed up
 *   - in a batch, from the editor, to everybody not yet stamped "Invited at"
 *
 * TO RUN THE BATCH: open the script editor, pick a function from the Run
 * menu, press Run. Apps Script's Run button cannot pass arguments, which is
 * why the two entry points below take none.
 *
 *   previewSampleClassInvites()   who would be mailed, mails nobody
 *   previewInviteText()           the message itself, both parts, sends nothing
 *   sendTestInvite()              one copy to yourself, touches no row
 *   sendSampleClassInvites()      mails them, stamps the Sheet
 *
 * Always run the preview first. It is the only thing standing between a typo
 * in the template and every lead you have.
 *
 * The mail does NOT list the eight dates. The Zoom registration page lists
 * them, that page is the one place they are true, and a copy here is a copy
 * that goes stale the first time an occurrence moves.
 */

/** Who it comes from. See "SENDING AS headroom@avand.fm" at the top. */
// Plain ASCII with no comma, quote or parenthesis in it, so it needs no
// quoting in the From header buildMime_ writes by hand. A name that ever
// gains one does.
var FROM_NAME = "Avand at Headroom";
var FROM_EMAIL = "headroom@avand.fm";

/**
 * Replies go to the address a person actually reads, not to the sending
 * alias. A reply to this mail is the most interested anybody has been so far.
 */
var REPLY_TO = "wave@avand.fm";

/**
 * Where the mail points. REGISTER_URL is a page on avand.fm that bounces to
 * Zoom rather than the Zoom URL itself -- see that page for why, but the short
 * of it is that a link already sent in an email cannot be corrected, and a
 * rebuilt Zoom meeting changes its registration URL.
 *
 * sendOneInvite_ still throws if either this or the address below is blank.
 * Emptying one to test something and forgetting is the failure that would
 * otherwise mail a dead link to the whole list.
 */
var REGISTER_URL = "https://avand.fm/headroom/sample/register";

/**
 * The postal address every commercial email is required to carry. Multi-line
 * because that is how an address is read; the HTML part joins it with <br>.
 */
var MAILING_ADDRESS = "Headroom\n3388 Triangle Rd.\nMariposa, CA 95338";

/**
 * Where the footer's unsubscribe link points. The address is appended as a
 * query parameter so the page arrives filled in and one press away.
 */
var UNSUBSCRIBE_URL = "https://avand.fm/headroom/unsubscribe";

/** How many one run will send. A cap, not a target -- see sendInvites_. */
var INVITE_BATCH_LIMIT = 100;

/* ------------------------------------------------------------------------ */
/* Entry points. No arguments, because the Run menu cannot pass any.         */
/* ------------------------------------------------------------------------ */

/** Logs who the batch would mail, and mails nobody. Run this first. */
function previewSampleClassInvites() {
  var result = sendInvites_({ dryRun: true });
  console.log(
    "Would mail " + result.sent + " of " + result.considered + " rows:\n" +
      result.recipients.join("\n")
  );
  if (result.skipped_why.length) {
    console.log("Skipping " + result.skipped + ":\n" + result.skipped_why.join("\n"));
  }
  return result;
}

/**
 * Logs the message both ways, and sends nothing.
 *
 * The plain-text part is derived rather than written, so it is the half
 * nobody has read. This is where to read it.
 */
function previewInviteText() {
  var body = inviteBody_("Alexa", "alexa@example.com");
  console.log("--- text ---\n" + body.text);
  console.log("--- html ---\n" + body.html);
  return body;
}

/**
 * Mails one invite to whoever is running this, and touches no row.
 *
 * The preview exercises the half of this that reads the Sheet. It cannot
 * exercise the other half at all -- the template, the MIME assembly, the From
 * header, whether any of it survives a real mail client -- and that half is
 * the one that goes out to everybody at once. This is how it gets looked at
 * before then.
 *
 * Read the delivered message's From line, not the execution log. A send that
 * went out from the wrong address is reported as a success by everything
 * except the message itself; see the note at the top of this file.
 *
 * It goes to REPLY_TO. That was Session.getActiveUser() for one version,
 * which reads better and wants userinfo.email -- a third scope, consented
 * forever, so that a test helper could work out an address this file already
 * has written down.
 *
 * One thing it cannot show you: how the message lands somewhere else. Mail
 * from this account to this account skips most of what a receiving provider
 * would do to it. Once this looks right, put a personal Gmail address in
 * below for one send and look at that too -- whether it arrives at all, and
 * whether Gmail files it under Promotions.
 */
function sendTestInvite() {
  sendOneInvite_("Avand", REPLY_TO);
  console.log("Sent to " + REPLY_TO + ". Check the From line, the link, and the footer.");
}

/** Mails everybody not yet stamped "Invited at", and stamps them. */
function sendSampleClassInvites() {
  var result = sendInvites_({ dryRun: false });
  console.log(
    "Mailed " + result.sent + ", skipped " + result.skipped +
      ", failed " + result.failed.length
  );
  if (result.skipped_why.length) console.log(result.skipped_why.join("\n"));
  if (result.failed.length) console.warn(result.failed.join("\n"));
  return result;
}

/* ------------------------------------------------------------------------ */
/* The batch                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Reads the signup tab and mails every row that has an email, whose address
 * has not been mailed already, and who has not unsubscribed since signing up.
 *
 * THIS READS ROWS, AND THE NOTE AT THE TOP OF THE FILE SAYS NOTHING HERE
 * EVER DOES. Both are true, and the difference is what runs them. That note
 * is about the *deployment* -- what a stranger's browser can reach through
 * the /exec URL, which is doPost and doGet and nothing else. Neither of them
 * calls this. It runs from the editor, under the owner's own account, where
 * reading the Sheet is reading a Sheet you own.
 *
 * Keep it that way. The moment doPost calls something that reads a row, the
 * web app gains a read surface, and the argument that makes "Who has access:
 * Anyone" safe stops holding.
 *
 * Stamping happens after a send succeeds, never before. A crash in the gap
 * between the two means somebody gets the mail twice on the next run, which
 * is the right way round: a duplicate is a small embarrassment and a silent
 * miss is a lead who never got what the button promised.
 */
function sendInvites_(opts) {
  opts = opts || {};
  var sheet = targetSheet(SHEET_NAME);
  assertInviteColumns_(sheet);

  var lastRow = sheet.getLastRow();
  var result = {
    considered: 0,
    sent: 0,
    skipped: 0,
    failed: [],
    recipients: [],
    // Why each skipped row was skipped. A count alone leaves you subtracting
    // one number from another and guessing at the difference, on the one
    // report whose job is to be read before mailing a list.
    skipped_why: [],
  };
  if (lastRow < 2) return result;

  var rows = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  var unsubscribedSince = unsubscribedSince_();

  // ADDRESSES, NOT ROWS
  //
  // Signing up twice is a real thing that happens -- a second ad, a second
  // visit -- and both rows are kept, because Source and Page differ between
  // them and that is the attribution. What must not happen twice is the mail.
  //
  // So the thing already-mailed is tracked by address rather than by row, and
  // seeded from every row the Sheet has already stamped rather than starting
  // empty each run. A duplicate is then skipped for the same reason on the
  // first run and the fifth: this person has had it. Its cell stays blank,
  // which is true -- that row never produced a send -- and the column stays
  // the dates its name promises.
  var mailed = {};
  for (var r = 0; r < rows.length; r++) {
    if (String(rows[r][INVITE_COL - 1] || "").trim()) {
      mailed[String(rows[r][EMAIL_COL - 1] || "").trim().toLowerCase()] = true;
    }
  }

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var rowNumber = i + 2;
    var email = String(row[EMAIL_COL - 1] || "").trim();
    var name = String(row[NAME_COL - 1] || "").trim();

    if (!email) continue;
    result.considered++;

    var key = email.toLowerCase();

    var skip = null;
    if (hasLeft_(unsubscribedSince[key], row[TIME_COL - 1])) {
      skip = "unsubscribed";
    } else if (String(row[INVITE_COL - 1] || "").trim()) {
      skip = "already invited";
    } else if (mailed[key]) {
      skip = "same address as a row already invited";
    }
    if (skip) {
      result.skipped++;
      result.skipped_why.push("row " + rowNumber + " " + email + " -- " + skip);
      continue;
    }

    if (result.sent >= INVITE_BATCH_LIMIT) break;

    result.recipients.push(name + " <" + email + ">");
    if (opts.dryRun) { result.sent++; mailed[key] = true; continue; }

    // One bad address must not halt the batch. A failure leaves the stamp
    // empty, so the next run picks that row up again with nothing to
    // remember.
    try {
      sendOneInvite_(name, email);
      stampInvited_(sheet, rowNumber, new Date());
      mailed[key] = true;
      result.sent++;
    } catch (err) {
      console.error(err);
      result.failed.push(email + ": " + err.message);
    }
  }

  return result;
}

/**
 * When each address last unsubscribed, lower-cased, as a lookup of Dates.
 *
 * WHEN AND NOT WHETHER, BECAUSE PEOPLE COME BACK
 *
 * Somebody who left in September and filled the signup form in again in
 * October has said two opposite things, and the second one is the one they
 * mean. A set of addresses cannot tell those apart and would keep them off
 * the list forever, having been asked to put them back on it.
 *
 * So the batch compares this against the Timestamp on their row: an
 * unsubscribe only silences a signup that came before it. That is the same
 * rule doPost already runs on when it mails a returning signup without
 * consulting this tab at all -- most recent statement wins -- and it means the
 * tab stays an append-only record. Nothing is ever deleted from it, which
 * matters the day somebody says they asked to leave and were ignored.
 *
 * The tab may not exist yet. That is not an error, it is a list nobody has
 * left.
 */
function unsubscribedSince_() {
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = book.getSheetByName(UNSUB_SHEET_NAME);
  var out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;

  var rows = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, UNSUB_HEADERS.length)
    .getValues();
  var timeCol = UNSUB_HEADERS.indexOf("Timestamp");
  var emailCol = UNSUB_HEADERS.indexOf("Email");

  for (var i = 0; i < rows.length; i++) {
    var email = String(rows[i][emailCol] || "").trim().toLowerCase();
    if (!email) continue;
    // A hand-typed row may hold anything, or nothing, in the date cell. An
    // unreadable date is treated as "just now" rather than ignored: the row
    // exists because somebody asked to leave, and the safe reading of an
    // ambiguous request to stop is to stop.
    var when = rows[i][timeCol] instanceof Date ? rows[i][timeCol] : new Date();
    if (!out[email] || when > out[email]) out[email] = when;
  }
  return out;
}

/**
 * Is this signup silenced by an unsubscribe?
 *
 * Only if the unsubscribe came after it. A signup with no readable timestamp
 * is treated as older than any unsubscribe -- an undated row is one of the
 * first, from before any of this existed, and none of those has asked to come
 * back.
 */
function hasLeft_(leftAt, signedUpAt) {
  if (!leftAt) return false;
  if (!(signedUpAt instanceof Date)) return true;
  return leftAt >= signedUpAt;
}

/** Writes the "Invited at" cell for one row. Always a Date. */
function stampInvited_(sheet, rowNumber, value) {
  sheet.getRange(rowNumber, INVITE_COL).setValue(value);
}

/**
 * Stops the batch if the tab is not laid out the way this file believes.
 *
 * Every column is addressed by position -- "Invited at" is column 6 because it
 * is sixth in HEADERS, not because a cell anywhere says so. Header text is
 * cosmetic to the code and load-bearing to nobody but a reader, which is the
 * arrangement that lets a hand-made column land in the wrong place and never
 * be noticed. Insert it before "Page" instead of after, and the run succeeds
 * and writes send times over the page every lead signed up from.
 *
 * So this reads the header row and refuses to run if it disagrees, naming the
 * column that is wrong. It writes nothing at all -- the column is made by
 * hand, once, in the Sheet. An earlier version of this created it instead,
 * and would then have sat here forever being a migration nobody needed twice.
 */
function assertInviteColumns_(sheet) {
  if (sheet.getLastRow() === 0) return;
  var header = sheet
    .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS.length))
    .getValues()[0];
  for (var c = 0; c < HEADERS.length; c++) {
    var found = String(header[c] || "").trim();
    if (found !== HEADERS[c]) {
      throw new Error(
        "Column " + (c + 1) + ' should be "' + HEADERS[c] + '" and is "' +
          found + '". Nothing sent -- fix the Sheet, not this file, unless ' +
          "the layout really did change."
      );
    }
  }
}

/* ------------------------------------------------------------------------ */
/* One message                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Builds and sends the invite to one person.
 *
 * Gmail.Users.Messages.send and not MailApp or GmailApp, for the reasons at
 * the top of the file: it is the only one of the three that both honours the
 * From header and asks for nothing beyond gmail.send.
 */
function sendOneInvite_(name, email) {
  if (!REGISTER_URL) throw new Error("REGISTER_URL is empty -- nothing sent");
  if (!MAILING_ADDRESS) throw new Error("MAILING_ADDRESS is empty -- nothing sent");

  var body = inviteBody_(name, email);
  var raw = buildMime_({
    to: email,
    subject: "Your Headroom sample class dates",
    text: body.text,
    html: body.html,
    unsubscribeUrl: body.unsubscribeUrl,
  });
  Gmail.Users.Messages.send({ raw: raw }, "me");
}

/**
 * The message, in both parts.
 *
 * The copy lives in invite.html, next to this file, so that reading or
 * changing it is reading or changing prose rather than picking it out of an
 * array of string fragments. The values below are everything it can say that
 * is not already written down in it.
 *
 * The plain-text part is derived from the HTML rather than written. It was
 * written, briefly, in a second file, and two files holding the same paragraphs
 * is two files that will one day hold different ones -- which spam filters
 * notice, and which nobody proofreads because both halves looked fine
 * separately.
 *
 * One function builds both parts, so the automatic send and the batch cannot
 * say different things.
 *
 * List-Unsubscribe is added in buildMime_ rather than here. The visible link
 * in the footer is the one the fine print on the site promises; the header is
 * what the big mailbox providers read.
 */
function inviteBody_(name, email) {
  // Prefills the field on the unsubscribe page, so leaving is one press. The
  // page still shows the address and lets it be changed -- a forwarded link
  // should unsubscribe whoever is reading it, not whoever sent it on.
  var unsubscribeUrl = UNSUBSCRIBE_URL + "?email=" + encodeURIComponent(email);
  var greeting = name ? "Hi " + name + "," : "Hi,";

  var values = {
    greeting: greeting,
    registerUrl: REGISTER_URL,
    unsubscribeUrl: unsubscribeUrl,
    address: MAILING_ADDRESS,
    addressHtml: esc_(MAILING_ADDRESS).replace(/\n/g, "<br />"),
  };

  var html = render_("invite", values);

  return {
    text: htmlToText_(html),
    html: html,
    unsubscribeUrl: unsubscribeUrl,
  };
}

/**
 * Fills one template file in.
 *
 * <?= ?> escapes, <?!= ?> does not. Everything reaching the template is
 * escaped except addressHtml, which is escaped by hand in inviteBody_ before
 * its newlines are turned into <br>.
 */
function render_(fileName, values) {
  var template = HtmlService.createTemplateFromFile(fileName);
  for (var key in values) template[key] = values[key];
  return template.evaluate().getContent();
}

/**
 * The HTML part, as plain text.
 *
 * WHY A HAND-ROLLED CONVERTER IS NOT MAD HERE
 *
 * Turning arbitrary HTML into readable text is a genuinely hard problem and
 * this is not it. The input is one file in this repo, written by us, using
 * six tags. What makes that safe is that the input cannot change without
 * somebody editing invite.html -- and if a tag appears there that this does
 * not know about, its content still comes through, just without the shaping.
 *
 * The one thing that must not be lost is the links. Text has nowhere to hide
 * an href, so an anchor becomes "label: url" -- the label alone would leave a
 * reader with no way to reach the thing the whole message is asking them to
 * do.
 */
function htmlToText_(html) {
  var text = html;

  // Anchors first, while the markup that holds the href is still there.
  // The label's trailing arrow goes: "Pick your session ->: https://..."
  // reads like a typo.
  text = text.replace(
    /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    function (match, href, label) {
      var clean = label.replace(/<[^>]+>/g, "").replace(/&rarr;|&#8594;/g, "");
      clean = clean.replace(/\s+/g, " ").trim();
      return clean ? clean + ": " + href : href;
    }
  );

  // A <br> is a break somebody meant. The source's own line endings are not
  // -- invite.html is indented for reading -- and the paragraph rebuild below
  // discards those. So the deliberate ones are carried through as a sentinel
  // that survives it, and turned back into newlines at the very end.
  text = text.replace(/<br\s*\/?>/gi, BREAK_);
  text = text.replace(/<hr\s*\/?>/gi, "\n--\n");

  // A list keeps its shape. Each item opens on a line of its own and carries
  // a dash, because the bullet is the markup -- strip it and two items become
  // two unexplained sentences with no visible relationship to each other.
  text = text.replace(/<li[^>]*>/gi, BREAK_ + "- ");
  text = text.replace(/<\/li>/gi, "");
  text = text.replace(/<\/(ul|ol)>/gi, "\n\n");

  // Blocks end in a blank line. Opening tags go with everything else below.
  text = text.replace(/<\/(p|div|h[1-6]|tr)>/gi, "\n\n");
  text = text.replace(/<[^>]+>/g, "");

  // The named entities invite.html actually uses, plus the three that must be
  // decoded last so that a literal "&amp;lt;" is not turned into "<".
  text = text
    .replace(/&mdash;|&#8212;/g, "--")
    .replace(/&ndash;|&#8211;/g, "-")
    .replace(/&rsquo;|&#8217;|&#39;/g, "'")
    .replace(/&lsquo;|&#8216;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&rarr;|&#8594;/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  // The source is indented for reading, so every line arrives with leading
  // whitespace and paragraphs arrive broken across lines that mean nothing.
  // Rebuild them: collapse each block to one line, then wrap it on purpose.
  var blocks = text.split(/\n{2,}/);
  var out = [];
  for (var i = 0; i < blocks.length; i++) {
    var segments = blocks[i].split(BREAK_);
    var wrapped = [];
    for (var j = 0; j < segments.length; j++) {
      var flat = segments[j].replace(/\s+/g, " ").trim();
      // An empty segment is <br><br> -- a blank line somebody asked for.
      // Kept, but never leading or trailing, where it would only pad the
      // message with whitespace nobody wrote.
      if (!flat) {
        if (wrapped.length) wrapped.push("");
        continue;
      }
      wrapped.push(wrap_(flat, 72));
    }
    while (wrapped.length && wrapped[wrapped.length - 1] === "") wrapped.pop();
    if (wrapped.length) out.push(wrapped.join("\n"));
  }
  return out.join("\n\n") + "\n";
}

/** Stands in for a <br> while paragraphs are rebuilt. Not typeable. */
var BREAK_ = "\u0000";

/**
 * Wraps on spaces at `width`, and never inside a word -- a URL longer than
 * the width goes on its own long line rather than being broken, because a
 * broken URL is a URL that does not work when somebody copies it.
 */
function wrap_(text, width) {
  var words = text.split(" ");
  var lines = [];
  var line = "";
  for (var i = 0; i < words.length; i++) {
    if (!line) { line = words[i]; continue; }
    if ((line + " " + words[i]).length <= width) {
      line += " " + words[i];
    } else {
      lines.push(line);
      line = words[i];
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * An RFC 822 message, multipart/alternative, base64url encoded for the API.
 *
 * Written out by hand because that is what Gmail.Users.Messages.send takes,
 * and because it is the only route where the From header is the one written
 * here rather than one substituted on the way out.
 *
 * Every part is base64 with an explicit UTF-8 charset. Apostrophes and dashes
 * in the copy are not ASCII, and a message that declares 7bit and carries
 * them arrives as mojibake in some clients and fine in others -- which is the
 * worst way to find out.
 */
function buildMime_(msg) {
  var boundary = "hr_" + Utilities.getUuid().replace(/-/g, "");
  var b64 = function (text) {
    return Utilities.base64Encode(text, Utilities.Charset.UTF_8);
  };

  var lines = [
    "From: " + FROM_NAME + " <" + FROM_EMAIL + ">",
    "To: " + msg.to,
    "Reply-To: " + REPLY_TO,
    // What Gmail and Outlook read to put their own unsubscribe control at the
    // top of the message, next to the sender.
    //
    // Both routes are offered, and there is deliberately no
    // List-Unsubscribe-Post. That header promises the URL will unsubscribe on
    // a bare POST with no confirmation, and this one will not: the page it
    // points at requires a press, because link scanners open every URL in a
    // message before a person sees it. Claiming one-click and then showing a
    // button is worse than not claiming it.
    "List-Unsubscribe: <" + msg.unsubscribeUrl + ">, <mailto:" +
      REPLY_TO + "?subject=Unsubscribe>",
    "Subject: " + msg.subject,
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="' + boundary + '"',
    "",
    "--" + boundary,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(msg.text),
    "",
    "--" + boundary,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(msg.html),
    "",
    "--" + boundary + "--",
    "",
  ].join("\r\n");

  return Utilities.base64EncodeWebSafe(lines, Utilities.Charset.UTF_8);
}

/** Minimal escaping for the few values that reach the HTML part. */
function esc_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
