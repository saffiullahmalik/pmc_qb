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

A signed-in user can read/write question data **only if** a document exists at `teachers/{their email, lowercase}` in Firestore, with one of five roles: `teacher` | `qb_lead` | `admin` | `external_reviewer` | `uploader`. Admins manage that collection — and the underlying login itself — from the app's own **Admin → Manage teachers** section (create/remove teachers, promote/demote), or by hand in the Firebase console as a fallback — there is no self-service approval flow either way, by design (an admin decides who gets in).

- `qb_lead` ("QB Lead" — was called "Head Teacher" until this rename) additionally unlocks setting a question's status to `finalized` — a plain `teacher` cannot finalize, and once finalized, further edits also require `qb_lead`/`admin` (enforced by `isQBLeadOrAdmin()` in `firestore.rules`, not just hidden client-side).
- `role: "admin"` additionally unlocks:
  - Entering post-test statistics (p-value / discrimination index)
  - Deleting questions
  - Deleting/updating others' comments
  - Managing workload `assignments` (the Assignment tab)
- `role: "external_reviewer"` (added Oct 2026) is a read-and-comment-only role for an outside reviewer who spot-checks questions — including **locked** ones — and leaves feedback for an admin to act on. They see the *same* Bank tab every teacher does -- full filters, search, and every question regardless of status (`renderBank()` branches on `isExternalReviewerUser` only to hide the "+ New Question" button, the "Only mine" filter, and each card's Edit/Locked button, not to replace the view) -- so they pick a question to review themselves, the same way a teacher picks one to read, rather than through a separate restricted screen. Every other nav tab is hidden for them client-side (an earlier version of this role had its own single "pick a random question" screen instead; that was replaced after feedback that reviewers need the normal filtered browsing experience, not a narrower one). In `renderDrawerBody()`, the Status section and Edit/Delete buttons are replaced with just a "Download as image…" button for this role, but the preview, peer-review section, and comment thread all render normally. Enforcement is server-side too, via a new `isContentTeacher()` function in `firestore.rules` (role in `["teacher","qb_lead","admin"]`) required for creating/editing questions and contests — `isTeacher()` (any of the four roles, including this one) still gates reads and comment-creation, since reading everything and commenting on anything (even locked) is exactly what this role is for. They're excluded from `pickReviewer()`'s balanced peer-review rotation and from the team comparison/leaderboard charts (`teacherComparisonData()`) — they don't author content or carry a quota. A comment from this role gets an "External Reviewer" badge in the thread (`reviewerBadge()` in `renderDrawerBody()`), and an admin viewing a **locked** question with such a comment sees an explicit callout prompting them to unlock it to act on the feedback.
- `role: "uploader"` (added Oct 2026) can only ever see the Upload tab — every other nav tab (including Bank) is hidden for them client-side, and `checkTeacherStatus()` forces `currentTab = "quilgo"` on sign-in since Bank, the app's normal default landing tab, isn't reachable for this role at all. Within Upload they can do everything the tab already offered any teacher — browse by category/day/slot, download a question's image, mark it uploaded/undo — no new UI was needed for that, since those actions were never `isAdminUser`-gated to begin with. Only "Mark this contest's upload complete" stays admin-only. Server-side, a new `isUploadOnlyChange()` in `firestore.rules`' `contests` match block allows any approved teacher (this role included) to update *just* `uploadStatus`/`quilgoComplete` on a contest, while creating a contest or changing any other field still requires `isContentTeacher()`. Excluded from `pickReviewer()` (allowlisted by role, not denylisted — see below) and from the team comparison/leaderboard charts, same reasoning as `external_reviewer`.

All of this is enforced in `firestore.rules`, not in client-side JS — the client UI hides admin controls from non-admins, but the real enforcement is server-side. Emails are lowercased on both sides (client lookup and rules) specifically because Firestore document IDs are case-sensitive and admins type them by hand — this was a real bug caught during setup and fixed.

Note: **"Remove" in Manage Teachers only deletes the `teachers/{email}` doc** (revokes app access) — it does not delete the underlying Firebase Auth login, since that requires the Admin SDK (a backend), which this Spark-plan/no-backend project deliberately doesn't have. A removed person's login still technically exists and they can still sign in, but they'll land on the "access pending" screen with no data access, same as before this feature existed. Full account deletion, if ever needed, is a manual step in Firebase console → Authentication → Users.

## Data model (Firestore)

```
questions/{questionId}
  titleEn, promptEn, promptUr,
  options: [{id, text, image}]   -- image is a compressed data-URL string or null
  correctOptionId,                -- id of the option in `options` that's correct
  graphicImage (data-URL or null), graphicImageWidth (px, teacher-adjustable), graphicNote (free text),
  commonEquation (free text, raw LaTeX with no $ delimiters -- auto-wrapped
  -- in $$...$$ at render time), shown once below both English and Urdu,
  -- the same "shared, not per-language" slot the figure already occupies.
  -- Rendered in the editor's live preview, the drawer/download's shared
  -- questionPreviewHtml(), and the Contests print view, all three now via
  -- the shared commonEquationHtml() helper (see below).
  fontSizeEn/fontSizeUr (px, default 15/14 -- Ur default lowered from 17 Oct
  -- 2026, Nastaliq script reads visually larger than Latin at the same
  -- px size; sliders now range 9-36px/9-40px, widened from 11-28/12-32),
  -- lineHeightEn/lineHeightUr (default 1.5/1.5, sliders now 1.0-3.0,
  -- widened from 1.1-2.2) -- set via the editor's live-preview +/-
  -- controls (previewEnSize/previewUrSize/previewEnLineHeight/
  -- previewUrLineHeight in openForm()).
  -- Fixed Oct 2026: these were only ever applied inside the editor's own
  -- live preview and never actually saved, so the chosen size/line-height
  -- never showed up in View, the downloaded image, or the print view --
  -- now persisted here and read with the same defaults by all three.
  fontFamilyEn/fontFamilyUr (CSS font stack string, default FONT_LIBRARY.en[0]/
  -- .ur[0] = Public Sans/Noto Nastaliq), textAlignEn/textAlignUr (left|center|
  -- right, default "left"/"right") -- Oct 2026, same pattern as fontSize/
  -- lineHeight above: a whole-box setting (not an inline wrapSelection()
  -- token like bold/italic/underline/color, since switching typeface
  -- mid-sentence doesn't make sense the way bold does), picked via a
  -- <select> + L/C/R buttons next to the existing live-preview steppers,
  -- read with the same ||default fallback at all three render sites.
  -- FONT_LIBRARY (top-level const) is the curated list each <select> offers;
  -- adding a font means adding one entry there (plus a Google Fonts @import
  -- for a non-web-safe face) -- nothing else needs to change.
  solutionEn (free text, feeds the print engine's Solution Manual -- REQUIRED,
  -- enforced client-side in openForm()'s save validation as of Sept 2026),
  level[] (subset of PMC-4/5/6/7), qType (aptitude|iq_puzzle|math_puzzle),
  difficulty (medium|hard|very_hard), unit (chapter code, e.g. "B3-C1"), subtopic,
  skills: [skillName, ...],   -- "skill tested" -- the transferable problem-
  -- solving technique (e.g. "Pattern Recognition", "Pigeonhole Principle"),
  -- distinct from unit/subtopic (content topic). Available list = a
  -- hardcoded DEFAULT_SKILLS seed (researched against how AMC 8/MATHCOUNTS
  -- categorize problems for this age band) unioned with every skill
  -- already used across questions (allSkills() in index.html) -- any
  -- teacher can add a new one from the editor, no admin step, no separate
  -- Firestore collection.
  usedIn: [contest name, ...],   -- NOTE: `uploadedToQuilgo` (bool) is deprecated/removed
  -- from the UI — Quilgo upload status now lives on contests/{id}.uploadStatus
  -- instead (see below), since "uploaded" only makes sense per contest paper.
  -- Old docs may still carry a stray uploadedToQuilgo field; it's just ignored.
  likes: [teacherEmail, ...],   -- a lightweight ♥ toggle, separate from the
  -- 5-star rating below; arrayUnion/arrayRemove, allowed even on a locked
  -- question (see isMetadataOnlyChange() in firestore.rules).
  peerReview: { reviewerEmail, reviewerName, assignedAt, submittedAt,
    reviewerOptionId, reviewerNote, reviewTimeMinutes, outcome } | null,
    -- added Oct 2026. Auto-assigned (pickReviewer() -- random among
    -- whoever has the fewest currently-"pending" reviews, i.e. balanced
    -- load, not round-robin) the moment status is set to "in_review" and no
    -- peerReview exists yet. Candidates are allowlisted by role (teacher or
    -- qb_lead only -- never admin/external_reviewer/uploader, and any
    -- future role is excluded by default instead of needing to be added to
    -- a denylist), AND must already have an assigned chapter quota
    -- somewhere (assignments.quotas) -- by request, someone with no
    -- assignment at all isn't part of this rotation. outcome is "pending" until the reviewer
    -- submits (openReviewForm()), then "agree" (their answer matched
    -- correctOptionId) or "disagree" (it didn't -- also auto-posts an
    -- explanatory comment). allowedStatusOptions() removes "finalized"
    -- from the status dropdown entirely -- not just a soft warning --
    -- until outcome is "agree", for every role including admin. Editing a
    -- "disagree" question resets peerReview to "pending" for the *same*
    -- reviewer (continuity) rather than picking someone new. No rules
    -- change needed for any of this -- the existing question-update rule
    -- already lets any teacher write to a non-finalized question
    -- regardless of authorship, which is exactly what a reviewer updating
    -- someone else's question needs.
    -- Admin -> Admin & Analytics -> "Pending reviews" (added Oct 2026)
    -- lists every question with peerReview.outcome==="pending" across the
    -- whole bank in one table (not one-at-a-time from inside each
    -- question), with a per-row dropdown (eligibleReviewerCandidates()) to
    -- reassign to a specific person, or a "Take back" button that sets
    -- peerReview to null entirely -- the question sits unassigned (status
    -- stays "in_review") until an admin reassigns it from here, or anyone
    -- re-clicks the drawer's "In Review" status button, which re-triggers
    -- pickReviewer() the same way it does for a question that's never had
    -- a reviewer at all.
  status (draft|in_review|finalized|uploaded),
  authorName, authorEmail, createdAt, updatedAt,
  editHistory: [{ts, by, note}, ...]

  -- legacy fields optionsEn[4]/correctIndex may still exist on questions
  -- created before the options rewrite; getQuestionOptions()/getCorrectOptionId()
  -- in index.html synthesize {id:"legacy-"+i, text, image:null} from them on
  -- read so old data keeps working without a migration script.

  questions/{id}/comments/{commentId}
    authorName, authorEmail, text, createdAt

  questions/{id}/ratings/{sanitizedRaterEmail}
    stars (1-5), ambiguous (bool), authorName, authorEmail, updatedAt

  questions/{id}/stats/post_test   (single doc)
    attempts, correct, topN, topCorrect, botN, botCorrect,
    pValue, discrimination, qualityLabel, qualityKey, enteredBy, updatedAt

contests/{contestId}
  name, headerText, durationMinutes, totalMarks,
  contestLevel (one of LEVELS), day (number), slot (number)
    -- added Sept 2026 so a contest represents one paper in the
    -- category × day × slot grid (e.g. PMC-4, Day 2, Slot 1), and the
    -- Upload tab (nav label "Upload" -- internally still named quilgo/Quilgo
    -- throughout the code and this doc, e.g. renderQuilgo(), data-tab="quilgo";
    -- only the user-visible text was de-branded in Oct 2026, not the
    -- identifiers) can find one paper via three cascading selects instead
    -- of a flat name search. Contests from before this change won't have
    -- these -- they surface under the "Unspecified" bucket, fixed via the
    -- Contests tab's Edit action (openContestForm(existing), which only
    -- edits these details, not questionIds -- re-picking questions on an
    -- existing paper is deliberately not supported, since a paper may
    -- already be partway through upload).
  questionIds: [id, ...]   -- order here is the paper's printed order (drag-and-drop set in the UI)
    -- The create-contest question picker (openContestForm's !isEdit branch)
    -- got a real filter/sort toolbar in Oct 2026 -- search text, chapter,
    -- difficulty, skill, author selects, a sort dropdown (chapter/difficulty/
    -- newest/author), and a "Hide already-used" checkbox (on by default) --
    -- plus "Select all filtered"/"Clear selection" buttons, because picking
    -- from thousands of locked questions by scrolling a single unfiltered
    -- list with 90-char-truncated prompts was unworkable at this project's
    -- real scale. Each row now shows the FULL question text (no truncation)
    -- plus unit/difficulty/author/skills tags, so a question can be
    -- evaluated without opening it. Filter state (pickerFilters) and the
    -- SORTERS map are scoped inside openContestForm(), reset fresh every
    -- time the modal opens. The chapter filter's options are rebuilt only
    -- on a category change (populateUnitFilterOptions()), not on every
    -- keystroke, since chapters are category-dependent and rebuilding the
    -- <select> on every filter change would blow away the chosen chapter.
  uploadStatus: { [questionId]: {uploadedBy, uploadedByName, uploadedAt} }
    -- Upload tracking lives HERE, not on the question doc, because
    -- "uploaded" only makes sense in the context of a specific contest paper.
    -- The Upload tab reads/writes this map keyed by question id.
  createdBy, createdByName, createdAt

assignments/{assignmentId}    -- the "Assignment" tab (workload distribution)
  name, contestLevel, units: [{unit, targetCount}], teacherEmails: [...],
  quotas: { [teacherEmail]: { [unit]: number } }, dueDate (YYYY-MM-DD or null),
  createdBy, createdByName, createdAt
  -- admins can edit/delete assignments from the Assignment tab's "Manage
  -- assignments" table, not just create new ones. As of Sept 2026,
  -- openAssignmentForm() presents these as a single drag-and-drop Kanban
  -- board spanning all four contest levels at once (one column per teacher
  -- plus an "Unassigned" pool per level, tab-switchable) -- the STORED shape
  -- is unchanged (still one doc per level), only how the admin builds it
  -- changed. A chapter card lives in exactly one column at a time, so
  -- assigning the same chapter to two teachers is structurally impossible.

teachers/{email, lowercase}
  role: "teacher" | "qb_lead" | "admin" | "external_reviewer" | "uploader"

curriculumExtra/{entryId}    -- admin-added books/chapters PLUS (Oct 2026)
  teacher-added subtopics, merged into allCurriculum() at read time with
  the hardcoded CURRICULUM constant -- additive only, the hardcoded data
  itself is never edited from the UI.
  type: "book"     -- {bookId, bookName, levels[], age, chapters:[]}
  type: "chapter"  -- {bookId, code, title, subtopics[]}
  type: "subtopic" -- {bookId, chapterCode, subtopic} -- appends one
    subtopic string to an existing chapter's `.subtopics` array (hardcoded
    or custom) without ever touching the chapter's own doc/data. The only
    type any content-teacher (not just admin) can create or update --
    firestore.rules checks `request.resource.data.type == "subtopic"` --
    so subtopics can grow collaboratively while books/chapters, and
    deletes of anything, stay admin-only.
  createdAt, createdBy
  -- Admin & Analytics -> Curriculum lists every entry with Edit/Remove;
  -- openCurriculumEditForm() in index.html edits the human-facing text
  -- only -- a chapter's `code` is deliberately NOT editable there (shown
  -- disabled, with an explanatory hint) since existing questions
  -- reference it directly via `unit`; renaming it out from under them
  -- would silently orphan those questions' chapter tag the same way
  -- deleting the entry does.

settings/sop    -- single doc, added Oct 2026 (SOP tab's admin-only Edit)
  sections: [{heading, body}, ...] -- body is raw text, not an array of
  -- paragraphs like the hardcoded SOP_TEXT it supersedes once saved: a
  -- blank line starts a new paragraph, a run of lines each starting with
  -- "- " becomes one bullet list (renderSOPBody() in index.html), and
  -- renderRichText()'s existing inline tokens (**bold**, *italic*,
  -- __underline__) still work inside the text. No raw HTML is ever
  -- accepted -- every line is escapeHtml()'d before token substitution,
  -- same safety approach as question text.
  fontSize (px, default 13.5), lineHeight (default 1.65) -- one global
  -- setting for the whole tab, not per-section.
  updatedAt, updatedByName
  -- Until this doc is ever written, renderSOP() falls back to the
  -- hardcoded SOP_TEXT constant (converted to the same {heading, body}
  -- shape) at the same default formatting, so the tab works correctly on
  -- a brand-new install with zero setup -- same pattern as settings/limits
  -- below. The hardcoded SOP_TEXT itself is never edited by this feature,
  -- only superseded once an admin saves their first edit.

settings/limits    -- single doc, added Oct 2026 (Admin -> Daily limits form)
  dailyCreationTarget (default 15), dailyCreationLimit (default 20),
  dailyReviewLimit (default 20)
  -- one global number each, not per-teacher. Read by every teacher
  -- (dailyLimits global in index.html, kept live via onSnapshot and
  -- defaulted to these same numbers before the doc is ever written, so a
  -- brand-new install behaves sensibly with no setup step); only an admin
  -- can write it. Enforced client-side only (countTodayCreated()/
  -- countTodaySubmittedReviews() in index.html) -- same "business rule,
  -- not a security boundary" treatment as the required-solution check.

Difficulty balance (Oct 2026, no new doc -- derived from assignments.quotas):
  each assigned chapter's target splits ~evenly across medium/hard/very_hard
  (difficultyQuotas(target) in index.html; a remainder not divisible by 3
  goes to medium then hard first). openForm()'s save validation blocks
  saving a question past a difficulty's share for a chapter that's actually
  assigned to the author (myAssignedChapters().find(...) in the
  step-submit handler) -- same client-side-only "business rule" treatment
  as the daily limits above, not a security boundary. The editor also
  shows this live (updateDifficultyBalanceHint(), triggered on chapter/
  level/difficulty change) before the teacher ever tries to save.

Progress breakdown (Oct 2026, no new field -- derived from status +
peerReview.outcome): countByStatus() returns FOUR mutually-exclusive,
sum-to-total buckets, not the 3 raw status values -- {draft, inReview,
reviewed, finalized, total}. "reviewed" is status==="in_review" AND
peerReview.outcome==="agree" (peer-reviewed and agreed, just waiting on a
QB Lead to click Lock); "inReview" is status==="in_review" with any other
peerReview state (still being worked, or disagreed). This split exists
because a real report showed the Workload tab's "Progress by level" chart
reading "8/180" while the roster directly below it read "0/45" for every
teacher -- the chart's number meant draft+inReview+done combined, not done,
against a target that means "locked" everywhere else. Every progress
display now shows locked/target as the headline number, with draft/
in-review/reviewed broken out explicitly alongside it (never silently
folded into one ambiguous total), and a "Complete" badge/checkmark appears
anywhere actual>=target>0 (progressCard(), the per-chapter/per-teacher
roster rows, the Workload level cards, the rail's assignment bars). A new
bar-reviewed CSS class (violet) renders this as a 4th stacked-bar segment
in barChartSvg()/hBarChartSvg(), between "locked" and "in review".

activityLog/{entryId}    -- admin-only audit trail (Admin tab's "Activity Log")
  type, summary, targetId, actorEmail, actorName, createdAt
  -- append-only (rules block update/delete entirely); any signed-in teacher
  -- can write an entry describing an action they just took (via the
  -- fire-and-forget logActivity() helper in index.html), but only admins
  -- can read the collection back. Separate from the Bank tab's "Recently
  -- posted" panel, which is the teacher-facing equivalent and just reads
  -- the existing `questions` list rather than a dedicated collection.
```

Filtering in the UI (level, type, difficulty, status, unit, search) is done **client-side** over the full `questions` collection (subscribed via `onSnapshot`, ordered by `createdAt desc`, capped at 500) — deliberately not server-side compound queries, since the dataset is small (a school's worth of exam questions, not a large-scale product).

Images (question figure + per-option images) are stored **inline on the Firestore document as compressed JPEG data-URLs**, not in Firebase Storage — a deliberate choice to stay on the free Spark plan (Storage now requires Blaze billing even for free-tier usage). `fileToCompressedDataUrl()` in `index.html` resizes/compresses client-side before writing, with a soft ~250KB-per-image budget so a question with several option images stays under Firestore's 1MB/doc cap. The Print/Export view can also shuffle each question's option order per printout (anti-copying) — grading stays correct either way because correctness is tracked by `correctOptionId`, never by array position.

**MathJax output mode is SVG (`tex-svg.js`), not the CHTML combo (`tex-mml-chtml.js`) — do not switch this back.** Fixed Oct 2026 after a real bug report of equations rendering garbled/doubled in downloaded images: html2canvas cannot reliably capture MathJax's rendered output directly (confirmed by testing — the live on-page rendering was pixel-perfect; only an html2canvas-captured canvas ghosted every equation, with CHTML and SVG output alike, regardless of `scale`/`letterRendering`/`foreignObjectRendering` options). The actual fix is `flattenMathToImages()` in `index.html`, called in `downloadQuestionImage()` right after `MathJax.typesetPromise()` and before `html2canvas()`: it walks every rendered `mjx-container svg`, serializes it to a data-URL, and replaces the container with a plain `<img>` — html2canvas draws a plain image via `drawImage()` instead of trying (and failing) to re-interpret MathJax's deeply-nested inline layout itself. This needs real `<svg>` elements to serialize, which is why the output mode had to move off CHTML (font-glyph-based, no equivalent `<svg>` per expression) to SVG. Separately, a multi-line `commonEquation` (a teacher pressing Enter between several equations) used to get wrapped as one `$$...$$` block — MathJax has no concept of a bare newline as a line break in math mode, so every line ran together with no separation, compounding the garbled look. `commonEquationHtml()` now splits on newlines and gives each non-empty line its own `$$...$$` block; use it (not a raw `$$${commonEquation}$$` wrap) at all three render sites (editor live preview, `questionPreviewHtml()`, Contests print view) if this is ever touched again.

## Files in this repo

- `index.html` — the entire app (UI + Firebase config + all logic). Real Firebase config values are already filled in (project `pmc-qb`) — not placeholders.
- `firestore.rules` — security rules, kept in the repo as the source of truth; must match what's actually published in the Firebase console (they can drift — the console is the live copy).
- `SETUP.md` — full click-by-click setup walkthrough (GitHub Pages + Firebase project creation, auth, Firestore, rules, teacher allow-list, auto-deploy). Written for a non-technical project owner, not a developer — verbose and screenshot-oriented in tone.
- `.github/workflows/deploy-firestore-rules.yml` — GitHub Action that deploys `firestore.rules` to Firebase automatically on push, **if** two repo secrets are set (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`). As of this writing it's unconfirmed whether those secrets were ever actually added — check before assuming this is live; if not, rules changes still need manual console paste.
- `PMC_Examination_SOP_v2.pdf` — the real official SOP; transcribed into the app's own "SOP" tab and into the difficulty/options-construction callouts in the question editor (`DIFFICULTY_SOP`/`OPTIONS_CONSTRUCTION_NOTE` in `index.html`). If this PDF is ever revised, those transcriptions need updating too — they're not generated from the PDF at runtime.
- `design-reference/` — prototype/source-art files (`pmc_4_v1.html`, a bubble-answer-sheet prototype, the logo's Illustrator source) kept for design reference, not runtime assets. `sundarstem_logo.png` stays at the repo root since `index.html` references it directly.
- `backup-viewer.html` — a standalone, offline, read-only viewer for a backup JSON file (the kind the Admin tab's "Export all data" button produces). No Firebase imports, no network calls at all — open it directly as a local file in any browser if the live site is ever unreachable. Deliberately separate from `index.html`.
- `PROJECT_GUIDE.md` — the plain-language companion to this file: what the portal does, every tab's purpose, the full question lifecycle including peer review, daily limits, and admin controls. Written for Saffi/teachers/admins, not for an AI or developer picking up the code — update it alongside this file whenever a workflow (not just the data model) changes.

## Status as of this writing (Sept 2026)

**Note:** the section below describes the original MVP handoff and is now out of date — three feature phases have shipped since (rebrand/contests/print engine; QB Lead role/live preview/workload; dynamic options with images/shuffle/full-page editor/drag-and-drop contest ordering/SOP tab). See `git log` for the real history; treat this section as historical context for the *original* build, not current status.

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
