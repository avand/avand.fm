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

function doPost(e) {
  try {
    var payload = parseBody(e);

    // One endpoint, two forms. Absent kind means the mailing list, so the
    // signup form keeps working unchanged and older cached copies of the page
    // -- which send no kind at all -- are not broken by this.
    var kind = String(payload.kind || "");
    if (kind === "privacy") return privacyRequest(payload);
    if (kind === "unsubscribe") return unsubscribeRequest(payload);

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
      sheet.appendRow([
        new Date(),
        name.slice(0, 100),
        email.slice(0, 254),
        String(payload.source || "").slice(0, 200),
        String(payload.page || "").slice(0, 500),
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
      email.slice(0, 254),
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
var FROM_NAME = "Avand Amiri";
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
 */
function sendTestInvite() {
  var to = Session.getActiveUser().getEmail();
  if (!to) throw new Error("No address for the active user -- run this from the editor");
  sendOneInvite_("Avand", to);
  console.log("Sent to " + to + ". Check the From line, the link, and the footer.");
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
 * The message, in both parts. One function, so the automatic send and the
 * batch cannot say different things.
 *
 * List-Unsubscribe is in buildMime_ rather than here; the visible link below
 * is the one the fine print on the site promises, and the header is what the
 * big mailbox providers read.
 */
function inviteBody_(name, email) {
  var hi = name ? "Hi " + name + "," : "Hi,";

  // Prefills the field on the unsubscribe page, so leaving is one press. The
  // page still shows the address and lets it be changed -- a forwarded link
  // should unsubscribe whoever is reading it, not whoever sent it on.
  var unsubscribeUrl =
    UNSUBSCRIBE_URL + "?email=" + encodeURIComponent(email);

  var text = [
    hi,
    "",
    "Thanks for signing up -- here are the dates, as promised.",
    "",
    "I'm running free one-hour sample classes through September. I'll teach",
    "you the AI-powered workflow I use to find, buy, and import new music,",
    "then open it up to your questions. It's a real class, not a sales call.",
    "",
    "Two times a week so you can pick what fits: Tuesdays at noon and",
    "Thursdays at 6 PM Mountain. Pick your session here:",
    "",
    REGISTER_URL,
    "",
    "You'll get a Zoom link and a calendar invite as soon as you register.",
    "",
    "The course itself runs Thursdays 6-8 PM Mountain, Oct 1 to Nov 19 --",
    "eight weeks, one small first cohort. I mention the time now because",
    "it's the part people need to plan around, and the Thursday sample",
    "class is that exact slot if you want to test drive it.",
    "",
    "Questions, just reply. This goes straight to me.",
    "",
    "Avand",
    "",
    "--",
    "You're getting this because you signed up at avand.fm.",
    "Unsubscribe: " + unsubscribeUrl,
    "",
    MAILING_ADDRESS,
  ].join("\n");

  var html = [
    "<p>" + esc_(hi) + "</p>",
    "<p>Thanks for signing up &mdash; here are the dates, as promised.</p>",
    "<p>I&rsquo;m running free one-hour sample classes through September. I&rsquo;ll teach you the AI-powered workflow I use to find, buy, and import new music, then open it up to your questions. It&rsquo;s a real class, not a sales call.</p>",
    "<p>Two times a week so you can pick what fits: <strong>Tuesdays at noon</strong> and <strong>Thursdays at 6 PM Mountain</strong>.</p>",
    '<p><a href="' + esc_(REGISTER_URL) + '">Pick your session &rarr;</a></p>',
    "<p>You&rsquo;ll get a Zoom link and a calendar invite as soon as you register.</p>",
    "<p>The course itself runs <strong>Thursdays 6&ndash;8 PM Mountain, Oct 1 &ndash; Nov 19</strong> &mdash; eight weeks, one small first cohort. I mention the time now because it&rsquo;s the part people need to plan around, and the Thursday sample class is that exact slot if you want to test drive it.</p>",
    "<p>Questions, just reply. This goes straight to me.</p>",
    "<p>Avand</p>",
    "<hr />",
    "<p><small>You&rsquo;re getting this because you signed up at avand.fm. " +
      '<a href="' + esc_(unsubscribeUrl) + '">Unsubscribe</a>.<br /><br />' +
      esc_(MAILING_ADDRESS).replace(/\n/g, "<br />") + "</small></p>",
  ].join("\n");

  return { text: text, html: html, unsubscribeUrl: unsubscribeUrl };
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
