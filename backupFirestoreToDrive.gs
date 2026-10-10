/**
 * PMC Question Bank — hourly Firestore backup to Google Drive
 * ============================================================
 *
 * What this does: every hour, signs in as a dedicated read-only teacher
 * account, pulls every collection the app's own "Export all data as JSON"
 * button exports (questions, contests, assignments, teachers,
 * curriculumExtra, settings/limits), and saves the result as a timestamped
 * JSON file in a Google Drive folder — in EXACTLY the same shape
 * exportAllData() in index.html produces, so any of these files opens
 * directly in backup-viewer.html. The point: if Firestore or the live site
 * is ever unreachable, there's never more than ~1 hour of missing data to
 * reconstruct, without anyone having to remember to click "Export" by hand.
 *
 * This script has NO write access to anything — it only reads Firestore
 * (via the signed-in account's normal read permissions, same as any
 * teacher) and creates files in one Drive folder you choose. It cannot
 * modify a question, mark anything uploaded, or change any teacher's
 * account.
 *
 * ---- ONE-TIME SETUP ----
 *
 * 1. Create a DEDICATED backup account in the live app itself:
 *    Admin → Manage teachers → Full name "Backup Bot" (or similar),
 *    any email, role "Automation" (NOT Admin — this role has the exact
 *    same read access a Teacher has, which is all this script needs, but
 *    is excluded from the Team/By-teacher performance charts and the
 *    Assignment board's columns, so it doesn't show up as an empty
 *    "teacher" alongside real staff). Generate a strong password and keep
 *    it for step 3.
 *
 * 2. In Drive, create (or pick) a folder for the backups to land in.
 *    Open it and copy the folder ID from its URL — the part after
 *    "/folders/", e.g. drive.google.com/drive/folders/<THIS PART>.
 *
 * 3. script.google.com → New project → delete the placeholder code →
 *    paste this whole file in → rename the project (e.g.
 *    "PMC QB Firestore Backup"). Then: ⚙ Project Settings → Script
 *    Properties → "Add script property", one row each:
 *      FIREBASE_PROJECT_ID   pmc-qb
 *      FIREBASE_API_KEY      AIzaSyCmETuuCc7khJuuW8RxxFxuQLPVQ3dZDwg
 *                             (the same apiKey already public in
 *                             index.html's FIREBASE_CONFIG — not a
 *                             secret, Firebase Web API keys are meant to
 *                             be client-visible; it only identifies which
 *                             project to talk to)
 *      BACKUP_EMAIL           the account from step 1
 *      BACKUP_PASSWORD        its password
 *      DRIVE_FOLDER_ID        the folder ID from step 2
 *      MAX_BACKUPS            72   (optional — keeps the most recent 72
 *                             hourly backups, ~3 days, and quietly
 *                             deletes older ones so the folder doesn't
 *                             grow forever; raise or remove this
 *                             property for a longer/unlimited history)
 *
 * 4. Back in the Apps Script editor, pick "testConnection" from the
 *    function dropdown at the top and click Run. The first run asks you
 *    to authorize — review the permissions (it needs to call external
 *    URLs for Firebase sign-in/Firestore, and to create files in Drive)
 *    and allow it. Check View → Logs / Executions for "Signed in OK" and
 *    a question count. If it fails, re-check the five properties above.
 *
 * 5. Once that works, run "installHourlyTrigger" once (same dropdown).
 *    That's it — it now runs every hour on its own. A new backup file
 *    named pmc-qb-backup-YYYY-MM-DD_HH-mm.json appears in the Drive
 *    folder each time. Download the newest one and open it with
 *    backup-viewer.html whenever you need it.
 *
 * To stop the automation later, run "removeHourlyTrigger" once.
 */

function runBackup() {
  var props = PropertiesService.getScriptProperties();
  var projectId = props.getProperty("FIREBASE_PROJECT_ID");
  var apiKey = props.getProperty("FIREBASE_API_KEY");
  var email = props.getProperty("BACKUP_EMAIL");
  var password = props.getProperty("BACKUP_PASSWORD");
  var folderId = props.getProperty("DRIVE_FOLDER_ID");
  var maxBackups = parseInt(props.getProperty("MAX_BACKUPS"), 10) || 72;

  if (!projectId || !apiKey || !email || !password || !folderId) {
    throw new Error(
      "Missing one or more required Script Properties (FIREBASE_PROJECT_ID, " +
      "FIREBASE_API_KEY, BACKUP_EMAIL, BACKUP_PASSWORD, DRIVE_FOLDER_ID) -- " +
      "see the setup comment at the top of this file."
    );
  }

  var idToken = signInAndGetIdToken_(apiKey, email, password);

  // Same six things exportAllData() in index.html reads, same shapes --
  // "teachers" uses "email" as its id key there (not "id"), everything
  // else uses "id".
  var questions = firestoreListDocuments_(idToken, projectId, "questions", "id");
  var contests = firestoreListDocuments_(idToken, projectId, "contests", "id");
  var assignments = firestoreListDocuments_(idToken, projectId, "assignments", "id");
  var teachers = firestoreListDocuments_(idToken, projectId, "teachers", "email");
  var curriculumExtra = firestoreListDocuments_(idToken, projectId, "curriculumExtra", "id");
  // settings/limits is a single document, not a collection -- falls back
  // to {} if it's never been written yet, same as dailyLimits defaults in
  // index.html for a brand-new install.
  var dailyLimits = firestoreGetDocument_(idToken, projectId, "settings/limits") || {};

  var payload = {
    exportedAt: new Date().toISOString(),
    exportedBy: "Automated backup (" + email + ")",
    questions: questions,
    contests: contests,
    assignments: assignments,
    teachers: teachers,
    curriculumExtra: curriculumExtra,
    dailyLimits: dailyLimits,
  };

  var folder = DriveApp.getFolderById(folderId);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Etc/UTC", "yyyy-MM-dd_HH-mm");
  var filename = "pmc-qb-backup-" + stamp + ".json";
  folder.createFile(filename, JSON.stringify(payload, null, 2), "application/json");

  pruneOldBackups_(folder, maxBackups);

  Logger.log(
    "Backup written: " + filename +
    " (" + questions.length + " questions, " + contests.length + " contests, " +
    teachers.length + " teachers)"
  );
}

// Quick credential/connectivity check without writing a backup file --
// run this first when setting up, or any time runBackup() starts failing.
function testConnection() {
  var props = PropertiesService.getScriptProperties();
  var idToken = signInAndGetIdToken_(
    props.getProperty("FIREBASE_API_KEY"),
    props.getProperty("BACKUP_EMAIL"),
    props.getProperty("BACKUP_PASSWORD")
  );
  var qs = firestoreListDocuments_(idToken, props.getProperty("FIREBASE_PROJECT_ID"), "questions", "id");
  Logger.log("Signed in OK. Found " + qs.length + " questions. Firestore reads are working.");
}

function installHourlyTrigger() {
  removeHourlyTrigger();
  ScriptApp.newTrigger("runBackup").timeBased().everyHours(1).create();
  Logger.log("Hourly backup trigger installed — runBackup() will now run automatically every hour.");
}

function removeHourlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "runBackup") ScriptApp.deleteTrigger(t);
  });
  Logger.log("Any existing hourly backup trigger has been removed.");
}

// ---------------- Firebase Auth + Firestore REST helpers ----------------
// Apps Script has no Firebase SDK, so this talks to the same two REST APIs
// the live app's own client SDK calls under the hood: Identity Toolkit
// (email/password sign-in) to get an ID token, then the Firestore REST API
// with that ID token as a Bearer credential -- which is exactly what
// firestore.rules' request.auth checks against, so this account is bound
// by the same isTeacher()/role rules as if it signed in through the app.

function signInAndGetIdToken_(apiKey, email, password) {
  var url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + encodeURIComponent(apiKey);
  var resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ email: email, password: password, returnSecureToken: true }),
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  var json = JSON.parse(resp.getContentText());
  if (code !== 200) {
    var msg = (json.error && json.error.message) || resp.getContentText();
    throw new Error("Firebase sign-in failed (" + code + "): " + msg);
  }
  return json.idToken;
}

// Lists every document in a top-level collection, decoded to plain JS
// objects, with `idKey` set to the document's own Firestore ID (e.g.
// {id: "...", ...fields} or, for teachers, {email: "...", ...fields} to
// match exportAllData()'s shape exactly). Paginates via pageToken since a
// collection can exceed one response page.
function firestoreListDocuments_(idToken, projectId, collection, idKey) {
  idKey = idKey || "id";
  var base = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents/" + collection;
  var out = [];
  var pageToken = "";
  do {
    var url = base + "?pageSize=300" + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
    var resp = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + idToken },
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error("Firestore list failed for \"" + collection + "\" (" + code + "): " + resp.getContentText());
    }
    var json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function (doc) {
      var obj = decodeFirestoreFields_(doc.fields || {});
      obj[idKey] = docIdFromName_(doc.name);
      out.push(obj);
    });
    pageToken = json.nextPageToken || "";
  } while (pageToken);
  return out;
}

// Fetches one specific document by path (e.g. "settings/limits"). Returns
// null if it doesn't exist yet (a brand-new install may never have
// written it) -- same "fall back to defaults" behavior as the live app.
function firestoreGetDocument_(idToken, projectId, path) {
  var url = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents/" + path;
  var resp = UrlFetchApp.fetch(url, {
    method: "get",
    headers: { Authorization: "Bearer " + idToken },
    muteHttpExceptions: true,
  });
  var code = resp.getResponseCode();
  if (code === 404) return null;
  if (code !== 200) {
    throw new Error("Firestore get failed for \"" + path + "\" (" + code + "): " + resp.getContentText());
  }
  var json = JSON.parse(resp.getContentText());
  return decodeFirestoreFields_(json.fields || {});
}

// Firestore's REST API wraps every value in a type tag, e.g.
// {stringValue:"x"} or {mapValue:{fields:{...}}} -- these two functions
// recursively unwrap that into plain JS values/objects/arrays, matching
// what the live app's client SDK hands index.html automatically.
function decodeFirestoreFields_(fields) {
  var out = {};
  Object.keys(fields || {}).forEach(function (k) {
    out[k] = decodeFirestoreValue_(fields[k]);
  });
  return out;
}
function decodeFirestoreValue_(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("bytesValue" in v) return v.bytesValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("arrayValue" in v) {
    var vals = (v.arrayValue && v.arrayValue.values) || [];
    return vals.map(decodeFirestoreValue_);
  }
  if ("mapValue" in v) {
    return decodeFirestoreFields_((v.mapValue && v.mapValue.fields) || {});
  }
  return null;
}

// "projects/.../databases/(default)/documents/questions/AbC123" -> "AbC123"
function docIdFromName_(name) {
  var parts = String(name || "").split("/");
  return parts[parts.length - 1];
}

// Keeps the most recent `maxBackups` files this script created (matched by
// filename prefix, so it never touches anything else in the folder) and
// trashes the rest, so a years-long hourly trigger doesn't fill Drive.
function pruneOldBackups_(folder, maxBackups) {
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    if (/^pmc-qb-backup-/.test(f.getName())) files.push(f);
  }
  files.sort(function (a, b) {
    return b.getDateCreated().getTime() - a.getDateCreated().getTime();
  });
  for (var i = maxBackups; i < files.length; i++) {
    files[i].setTrashed(true);
  }
}
