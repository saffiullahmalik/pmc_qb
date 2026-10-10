# PMC Question Bank — GitHub Pages + Firebase Setup

This turns the question-bank portal into a site you host yourself on GitHub Pages, with a real login system (email + password, accounts created only by an admin — no self sign-up) backed by Firebase (free tier).

Total one-time setup: **~20–30 minutes**. You only do this once; after that, teachers just visit the URL and sign in.

---

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with the Google account you want to own this project.
2. Click **Add project**. Name it (e.g. `pmc-question-bank`). You can disable Google Analytics for this project — not needed.
3. Once created, you land on the project overview.

## 2. Enable Email/Password sign-in

1. In the left sidebar: **Build → Authentication → Get started**.
2. Under **Sign-in method**, click **Email/Password**, toggle it **Enable**, **Save**.
3. If **Google** is enabled from an earlier version of this project, you can disable it now — this version doesn't use it. (If you already have an admin account that was created via Google sign-in, see the note at the end of this step before disabling it.)

> **Migrating an existing Google-sign-in admin to email/password:** their account and `teachers` document don't need to be recreated — just add a password to the *same* account. On the site's sign-in screen, click **Forgot password?**, enter that admin's email, and follow the reset link that arrives by email to set a password. They can then sign in with email + that password as before, still recognized as the same admin (the `teachers/{email}` document is unaffected).

## 3. Create the Firestore database

1. Left sidebar: **Build → Firestore Database → Create database**.
2. Choose a location close to Pakistan (e.g. `asia-south1` (Mumbai) or `asia-southeast1`). Location can't be changed later, but it barely matters at this scale.
3. Start in **production mode** (we'll paste in real security rules next — do not leave it in test mode).

## 4. Add the security rules

1. In Firestore, go to the **Rules** tab.
2. Replace the contents with the file `firestore.rules` from this repo (paste its full contents in).
3. Click **Publish**.

These rules mean: only signed-in accounts that have a document in a `teachers` collection can read or write question data, and only accounts marked `role: "admin"` can enter post-test statistics or delete questions. There is no self-service sign-up — you control exactly who has access.

## 5. Create your own admin account

This one-time step needs the Firestore *and* Authentication consoles, because you're not an admin yet — nobody is:

1. **Authentication** → **Users** tab → **Add user**. Enter your email and a password. Click **Add user**.
2. **Firestore** → **Data** tab → **Start collection** → collection ID: `teachers`.
3. **Add document** → **Document ID**: your exact email (lowercase, must match what you just typed in step 1) → add a field `role` (string) = `admin` → **Save**.
4. Sign in to the site with that email + password — you're in as admin.

After that, **you never need to touch the console for onboarding again.** Sign in, go to **Admin & Analytics → Manage teachers**, fill in a name, email, and password, pick a role, and click **Create account** — this creates both the login and the `teachers` document in one step. Promote, demote, or remove access the same way, all from the site.

## 6. Register a web app and get your config

1. Project settings (gear icon, top left) → scroll to **Your apps** → click the **</>** (Web) icon.
2. Give it a nickname (e.g. `pmc-bank-web`), no need to set up Firebase Hosting here — you're using GitHub Pages instead.
3. Firebase shows you a `firebaseConfig` object with `apiKey`, `authDomain`, `projectId`, etc. Copy these values.
4. Open `index.html` in this repo and find the `window.FIREBASE_CONFIG = {...}` block near the top of the `<script>` section. Replace each `"REPLACE_ME"` with your real value.

## 7. Authorize your GitHub Pages domain

1. Firebase console → **Authentication → Settings → Authorized domains**.
2. Add your GitHub Pages domain, e.g. `<your-username>.github.io` (or your custom domain if you attach one later). This is what lets password-reset email links point back to your live site correctly.

## 8. Push to GitHub and enable Pages

In your existing repo:

```bash
# from inside your repo's working copy
cp /path/to/index.html .
cp /path/to/firestore.rules .   # keep for reference / re-pasting into console later
git add index.html firestore.rules SETUP.md
git commit -m "Add PMC question bank portal"
git push
```

Then on GitHub: **Settings → Pages** → under "Build and deployment", set **Source: Deploy from a branch**, pick your branch (usually `main`) and folder `/ (root)` (or `/docs` if that's where you put `index.html` — adjust accordingly), **Save**.

GitHub gives you a URL like `https://<your-username>.github.io/<repo-name>/` within a minute or two. Share that with your teachers.

---

## Ongoing admin tasks

- **Create a teacher login, promote/demote, or remove access:** sign in to the site as an admin → **Admin & Analytics → Manage teachers**. This is the normal way to do it day-to-day — "Create account" makes both the login and the allow-list entry in one step.
- Note: **"Remove" only revokes app access** (deletes the `teachers` document) — it doesn't delete the underlying login, since that needs the Firebase Admin SDK (a backend), which this project deliberately doesn't have on the free Spark plan. A removed person's login still exists but they can't get past "access pending." To fully delete a login, do it by hand: Authentication → Users → find them → delete.
- The teacher list can still be edited by hand in Firestore if you ever need to (`teachers` collection → add/edit/delete a document, doc ID = their email, field `role` = `teacher` or `admin`) — useful as a fallback if, say, an admin locks themselves out of their own account.
- **Back up the question bank:** Firestore → Data → the `⋮` menu has an export option (or use `gcloud firestore export` for a full backup on the free tier's underlying project).

## Cost

Firebase's free "Spark" plan covers this comfortably at the scale of a teacher question bank (reads/writes in the thousands per day, low storage). You won't need to enter billing details unless usage grows far beyond this project's scope.

## 9. Optional: auto-deploy Firestore rules on every push

Without this, changing `firestore.rules` means pasting it into the Firebase console by hand each time (step 4 above). This step makes GitHub deploy the rules for you automatically whenever you push a change to that file — a `.github/workflows/deploy-firestore-rules.yml` file is already included in this repo and does the deploying; you just need to give it credentials once.

1. **Create a service account.** Go to [console.cloud.google.com](https://console.cloud.google.com), make sure the project selector (top bar) is set to your Firebase project (same name/ID as in step 1), then go to **IAM & Admin → Service Accounts → Create service account**. Name it e.g. `github-actions-deploy`. On the permissions step, grant it the role **Firebase Rules Admin** (search "Firebase Rules Admin" — if you'd rather not hunt for the narrowest role, **Editor** also works but is broader than needed). Click through to finish.
2. **Download a key.** Open the new service account → **Keys** tab → **Add key → Create new key → JSON**. This downloads a `.json` file — keep it private, don't commit it to the repo.
3. **Add two GitHub secrets.** In your repo: **Settings → Secrets and variables → Actions → New repository secret**.
   - `FIREBASE_PROJECT_ID` — your Firebase project ID (from step 1; also visible in Project settings).
   - `FIREBASE_SERVICE_ACCOUNT` — open the downloaded JSON file in a text editor, select all, and paste the entire contents as the secret value.
4. That's it. Push any change to `firestore.rules` on your default branch and the **Actions** tab will show the deploy running automatically — no more manual console paste.

Note: this only automates the *rules*. The `teachers` collection (who's allowed in, and who's admin) is still managed by hand in the Firestore console, by design — it's exactly the kind of change you want to make deliberately, not have deploy itself from a file in the repo.

## 10. Optional: link your computer to Claude for a no-upload workflow

If you're working with Claude in Cowork, open this task in the Claude desktop app and choose **"Link to this computer."** Once linked, future sessions can edit files in your actual repo folder and run `git commit`/`git push` directly using your machine's existing GitHub login — skipping the "Upload files" step entirely. GitHub Pages and the Action above then take care of the rest automatically.

## 11. Optional: automatic hourly backups to Google Drive

The Admin tab's "Export all data as JSON" button is great, but only if someone remembers to click it. `backupFirestoreToDrive.gs` (in this repo) is a small Google Apps Script that does the same export automatically, every hour, straight into a Drive folder — so there's never more than about an hour of data to lose track of. Takes about 10 minutes, once.

1. **Create a dedicated backup login.** Sign in to the live site as admin → **Admin & Analytics → Manage teachers**. Create a new account: any full name (e.g. `Backup Bot`), any email (doesn't need to be real/receive mail, just needs to be a valid-looking address, e.g. `backup@yourschool.example`), a strong password, and **role: Automation (service account)**. This role can read everything the backup needs — the same as a Teacher — but is left out of the Team/By-teacher performance charts and the Assignment board's columns, so it never shows up as a confusing empty "teacher" next to your real staff. Write the email and password down somewhere safe — you'll paste them in shortly.

2. **Pick a Drive folder.** In [drive.google.com](https://drive.google.com), create a new folder (e.g. "PMC QB Backups") or use an existing one. Open it and look at the address bar — the folder ID is the long string of letters/numbers after `/folders/`. Copy it.

3. **Create the Apps Script project.**
   - Go to [script.google.com](https://script.google.com) → **New project**.
   - Delete the placeholder `function myFunction() {...}` code that's there by default.
   - Open `backupFirestoreToDrive.gs` from this repo, select all, copy, and paste it into the empty script editor.
   - Click the project name at the top left (something like "Untitled project") and rename it, e.g. `PMC QB Firestore Backup`.

4. **Set the five Script Properties.** Still in the Apps Script editor: click the **⚙ Project Settings** gear icon on the left sidebar → scroll to **Script Properties** → **Add script property**, and add each of these as its own row (property name on the left, value on the right):

   | Property | Value |
   |---|---|
   | `FIREBASE_PROJECT_ID` | `pmc-qb` |
   | `FIREBASE_API_KEY` | `AIzaSyCmETuuCc7khJuuW8RxxFxuQLPVQ3dZDwg` |
   | `BACKUP_EMAIL` | the email from step 1 |
   | `BACKUP_PASSWORD` | the password from step 1 |
   | `DRIVE_FOLDER_ID` | the folder ID from step 2 |

   (`FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY` are the same values already sitting in `index.html`'s `FIREBASE_CONFIG` — not secrets, just which project to talk to. `MAX_BACKUPS` is an optional sixth row if you ever want to keep more or fewer than the default 72 hourly backups, ~3 days.)

5. **Test it.** Back in the **Editor** tab (left sidebar), use the function dropdown at the top (next to the "Run" button — it may default to `runBackup`) and pick **`testConnection`**, then click **Run**.
   - The first time, Google will ask you to authorize the script — click **Review permissions**, pick your Google account, click **Advanced → Go to [project name] (unsafe)** (this warning is normal for your own just-written script — Google shows it for anything not yet published to the store), then **Allow**.
   - Open **View → Logs** (or **Executions** in the left sidebar) and confirm you see `Signed in OK. Found N questions.` If it errors instead, re-check the five properties from step 4 — a typo in the email/password or project ID is the usual cause.

6. **Turn on the hourly automation.** Pick **`installHourlyTrigger`** from the same function dropdown and click **Run** once. That's it — `runBackup` now runs automatically every hour, no further steps. A new file named `pmc-qb-backup-YYYY-MM-DD_HH-mm.json` will appear in your Drive folder each time.

Whenever you need a backup, grab the newest file from that Drive folder and open it with `backup-viewer.html` (just double-click it, load the JSON file). To stop the automation later, run `removeHourlyTrigger` once from the same dropdown.

## What stayed the same vs. the Claude-hosted version

Same data model, same tagging taxonomy, same p-value/discrimination-index analytics, same UI — the only thing that changed is *where it lives* (your own GitHub Pages URL instead of a claude.ai link) and *how people sign in* (a real email/password login, accounts created only by an admin, enforced server-side by Firestore rules, instead of a typed name).
