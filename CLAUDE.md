# PMC Question Bank — Project Context

Read this before making changes. It's written for Claude Code (or any AI assistant) picking up this project fresh, with no memory of the conversation that built it.

## What this project is

Sundar STEM School (Lahore, Pakistan) runs the **Pakistan Math Contest (PMC)** — a national-level talent-identification exam across four age bands:

| Contest | Age | Curriculum anchor |
|---|---|---|
| PMC-4 | 10 | Beast Academy Book 3 |
| PMC-5 | 11 | Beast Academy Book 4 |
| PMC-6 / PMC-7 | 12 / 13 | Beast Academy Book 5 |

This repo is a **web portal where teachers (question setters) collaboratively draft, tag, peer-review, and finalize PMC exam questions** before they're screenshotted and uploaded to Quilgo (an AI-proctored test delivery tool) for the live exam. After each test cycle, admins enter performance data (p-value, discrimination index) to flag weak or ambiguous questions for revision.

The portal's design follows an official school SOP ("Preparation, Review, Administration, and Publication of PMC Examination Papers") — see `SETUP.md` and the companion teacher guide (not in this repo; ask the project owner, Saffi, for `PMC_Question_Setter_Guide.md` if it's needed — it has the full pedagogical rationale: difficulty-ladder design, CPA/ZPD/Bloom's taxonomy guidance, the Beast Academy → PMC curriculum map, tagging taxonomy, and p-value/discrimination formulas).

## Architecture

- **Hosting**: static site on **GitHub Pages**, this repo (`saffiullahmalik/pmc_qb`), served from `main` branch, root folder. Live at `https://saffiullahmalik.github.io/pmc_qb/`.
- **Everything is one file**: `index.html` — vanilla JS (no build step, no framework, no bundler). Firebase SDK is loaded via ES module imports directly from `gstatic.com` CDN (`firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js`, v10.13.0, pinned).
- **Backend**: Firebase project `pmc-qb` (Spark/free plan).
  - **Auth**: email + password (`signInWithEmailAndPassword`). There is no self sign-up — accounts are created only by an admin, from **Admin → Manage teachers**, which sets email/password/name and writes the `teachers/{email}` doc in one step. Account creation uses a throwaway secondary Firebase App instance (`initializeApp(config, "Secondary-"+timestamp)`) purely so `createUserWithEmailAndPassword` doesn't hijack the admin's own signed-in session — this is the standard client-only workaround for admin-provisioned users on a backend-less (Spark plan) project. A "Forgot password" flow (`sendPasswordResetEmail`) lets teachers reset their own password after that. Note: this was Google sign-in (`signInWithPopup`) until Sept 2026, when it was deliberately replaced with this admin-provisioned email/password model — if you see Google sign-in code again, something got reverted.
  - **Database**: Firestore, in production mode, access controlled entirely by `firestore.rules` (also in this repo — must be manually pasted into the Firebase console's Rules tab and Published; there's a GitHub Action, see below, that can do this automatically instead).

## Access control model (important — don't weaken this without discussion)

A signed-in user can read/write question data **only if** a document exists at `teachers/{their email, lowercase}` in Firestore. Admins manage that collection — and the underlying login itself — from the app's own **Admin → Manage teachers** section (create/remove teachers, promote/demote to admin), or by hand in the Firebase console as a fallback — there is no self-service approval flow either way, by design (an admin decides who gets in). A `role: "admin"` field on that same document additionally unlocks:
- Entering post-test statistics (p-value / discrimination index)
- Deleting questions
- Deleting/updating others' comments

All of this is enforced in `firestore.rules`, not in client-side JS — the client UI hides admin controls from non-admins, but the real enforcement is server-side. Emails are lowercased on both sides (client lookup and rules) specifically because Firestore document IDs are case-sensitive and admins type them by hand — this was a real bug caught during setup and fixed.

Note: **"Remove" in Manage Teachers only deletes the `teachers/{email}` doc** (revokes app access) — it does not delete the underlying Firebase Auth login, since that requires the Admin SDK (a backend), which this Spark-plan/no-backend project deliberately doesn't have. A removed person's login still technically exists and they can still sign in, but they'll land on the "access pending" screen with no data access, same as before this feature existed. Full account deletion, if ever needed, is a manual step in Firebase console → Authentication → Users.

## Data model (Firestore)

```
questions/{questionId}
  titleEn, promptEn, promptUr, optionsEn[4], correctIndex,
  level[] (subset of PMC-4/5/6/7), qType (aptitude|iq_puzzle|math_puzzle),
  difficulty (medium|hard|very_hard), unit (e.g. "5C"), subtopic,
  graphicNote, status (draft|in_review|finalized|uploaded),
  authorName, authorEmail, createdAt, updatedAt,
  editHistory: [{ts, by, note}, ...]

  questions/{id}/comments/{commentId}
    authorName, authorEmail, text, createdAt

  questions/{id}/ratings/{sanitizedRaterEmail}
    stars (1-5), ambiguous (bool), authorName, authorEmail, updatedAt

  questions/{id}/stats/post_test   (single doc)
    attempts, correct, topN, topCorrect, botN, botCorrect,
    pValue, discrimination, qualityLabel, qualityKey, enteredBy, updatedAt

teachers/{email, lowercase}
  role: "teacher" | "admin"
```

Filtering in the UI (level, type, difficulty, status, unit, search) is done **client-side** over the full `questions` collection (subscribed via `onSnapshot`, ordered by `createdAt desc`, capped at 500) — deliberately not server-side compound queries, since the dataset is small (a school's worth of exam questions, not a large-scale product).

## Files in this repo

- `index.html` — the entire app (UI + Firebase config + all logic). Real Firebase config values are already filled in (project `pmc-qb`) — not placeholders.
- `firestore.rules` — security rules, kept in the repo as the source of truth; must match what's actually published in the Firebase console (they can drift — the console is the live copy).
- `SETUP.md` — full click-by-click setup walkthrough (GitHub Pages + Firebase project creation, auth, Firestore, rules, teacher allow-list, auto-deploy). Written for a non-technical project owner, not a developer — verbose and screenshot-oriented in tone.
- `.github/workflows/deploy-firestore-rules.yml` — GitHub Action that deploys `firestore.rules` to Firebase automatically on push, **if** two repo secrets are set (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`). As of this writing it's unconfirmed whether those secrets were ever actually added — check before assuming this is live; if not, rules changes still need manual console paste.

## Status as of this writing (Sept 2026)

Done and verified working end-to-end by the project owner:
- GitHub Pages live and serving `index.html` at the URL above.
- Firebase project created, Firestore database created, security rules published.
- Email/password auth enabled and working (swapped from an initial Google-sign-in-only build).
- Owner's own account added to `teachers` as `role: admin`.
- Successfully signed in and posted a test question — confirmed visible in the Firestore `questions` collection.

Known open items / things to sanity-check on pickup:
- Confirm whether the GitHub Action's two secrets were ever set up — if not, rules deploys are still manual.
- Only one teacher account exists so far (the owner). The rest of the teaching staff still need to be onboarded (self-signup on the site, then an admin adds their email to `teachers` in the Firebase console).
- No automated tests exist. Changes have been verified manually via the live site + Firestore console.
- The portal has never been used through a full real exam cycle yet — the post-test statistics (p-value/discrimination) feature is built and functional but untested against real data.
- Custom domain, Firebase Blaze upgrade, and Firebase App Hosting were all explicitly considered and rejected/deferred — GitHub Pages + Firebase Spark plan is the deliberate choice for this project's scale. Don't "fix" this unless asked.

## Working conventions

- Keep it a single-file static app unless there's a real reason to add a build step — that's a deliberate simplicity choice for a non-developer owner to be able to understand/edit/redeploy by hand if needed.
- Any change to `firestore.rules` needs to be pasted into the Firebase console manually (or pushed, if the Action's secrets are configured) — editing the file in the repo alone does **not** change what's enforced live.
- When editing `index.html`, keep the design tokens (CSS custom properties at the top) consistent — teal accent (`--accent`), Lexend/Public Sans/IBM Plex Mono type system, light/dark theme support via `prefers-color-scheme`.
