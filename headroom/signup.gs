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
 * 1. The Sheet is "Headroom CRM" -- SPREADSHEET_ID below. Rows land on its
 *    first tab, or on SHEET_NAME if that is set to a tab that exists.
 * 2. In that Sheet: Extensions > Apps Script. Delete the placeholder file and
 *    paste this one in. Save.
 * 3. Deploy > New deployment > type "Web app".
 *      Execute as:      Me
 *      Who has access:  Anyone            <-- not "Anyone with Google account"
 *    Deploy, approve the permission prompt, and copy the /exec URL.
 * 4. Paste that URL into SIGNUP_ENDPOINT in index.html.
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
 * Re-deploying: Deploy > Manage deployments > edit > Version: New version.
 * Editing the code alone changes nothing until a new version is deployed, and
 * the URL stays the same across versions.
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

/** The tab to append to. Empty string means the first tab in the Sheet. */
var SHEET_NAME = "";

/** Columns, in order. Changing this changes new rows only. */
var HEADERS = ["Timestamp", "First name", "Email", "Source", "Page"];

function doPost(e) {
  try {
    var payload = parseBody(e);

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
      var sheet = targetSheet();
      ensureHeaders(sheet);

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

function targetSheet() {
  var book = SpreadsheetApp.openById(SPREADSHEET_ID);
  // A SHEET_NAME that matches nothing would otherwise return null and fail
  // deeper in, on a stack that says nothing about the actual mistake.
  var sheet = SHEET_NAME ? book.getSheetByName(SHEET_NAME) : book.getSheets()[0];
  if (!sheet) throw new Error('No tab named "' + SHEET_NAME + '"');
  return sheet;
}

/** Write the header row once, on the first submission into an empty sheet. */
function ensureHeaders(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(HEADERS);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
  sheet.setFrozenRows(1);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
