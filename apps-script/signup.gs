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
 * The Sheet is "Headroom CRM" -- SPREADSHEET_ID below. Both tabs it writes to
 * are named in the constants below and must already exist under exactly those
 * names, capitals included. Renaming a tab in the Sheet without changing the
 * constant breaks that form.
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
 * all. Nothing here ever calls getRange or getValues to read a row.
 *
 * Those two are the whole reason a stranger's browser can write to a private
 * Sheet, so they are worth checking after any change to appsscript.json: a
 * deployment that comes back as "Anyone with a Google account" does not error,
 * it just quietly rejects every visitor who is not signed in.
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

/** Columns, in order. Changing this changes new rows only. */
var HEADERS = ["Timestamp", "First name", "Email", "Source", "Page"];

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

/** What the form may ask for. Anything else is recorded as "other". */
var REQUEST_KINDS = ["copy", "correct", "delete", "other"];

function doPost(e) {
  try {
    var payload = parseBody(e);

    // One endpoint, two forms. Absent kind means the mailing list, so the
    // signup form keeps working unchanged and older cached copies of the page
    // -- which send no kind at all -- are not broken by this.
    if (String(payload.kind || "") === "privacy") return privacyRequest(payload);

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

    try {
      var sheet = targetSheet(SHEET_NAME);
      ensureHeaders(sheet, HEADERS);

      // Capped because nothing upstream of a public URL limits the length of
      // what arrives, and a cell holding a novel is a nuisance to clean up.
      sheet.appendRow([
        new Date(),
        name.slice(0, 100),
        email.slice(0, 254),
        String(payload.source || "").slice(0, 200),
        String(payload.page || "").slice(0, 500),
      ]);
    } finally {
      lock.releaseLock();
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
      email.slice(0, 254),
      kind,
      String(payload.message || "").slice(0, 2000),
      String(payload.page || "").slice(0, 500),
    ]);
  } finally {
    lock.releaseLock();
  }

  return json({ ok: true });
}

/**
 * Both tabs are found by name now -- there is no "first tab" fallback left, on
 * purpose. `create` makes the tab if it is missing, which the requests tab
 * needs and the signup tab must not have, for the reason given at SHEET_NAME.
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
