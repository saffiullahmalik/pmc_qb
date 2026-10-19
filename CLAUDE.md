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

A signed-in user can read/write question data **only if** a document exists at `teachers/{their email, lowercase}` in Firestore, with one of seven roles: `teacher` | `qb_lead` | `admin` | `external_reviewer` | `uploader` | `automation` | `student_reviewer`. Admins manage that collection — and the underlying login itself — from the app's own **Admin → Manage teachers** section (create/remove teachers, promote/demote), or by hand in the Firebase console as a fallback — there is no self-service approval flow either way, by design (an admin decides who gets in).

- `qb_lead` ("QB Lead" — was called "Head Teacher" until this rename) additionally unlocks setting a question's status to `finalized` — a plain `teacher` cannot finalize, and once finalized, further edits also require `qb_lead`/`admin` (enforced by `isQBLeadOrAdmin()` in `firestore.rules`, not just hidden client-side).
- `role: "admin"` additionally unlocks:
  - Entering post-test statistics (p-value / discrimination index)
  - Deleting questions
  - Deleting/updating others' comments
  - Managing workload `assignments` (the Assignment tab)
- `role: "external_reviewer"` (added Oct 2026) is a read-and-comment-only role for an outside reviewer who spot-checks questions — including **locked** ones — and leaves feedback for an admin to act on. They see the *same* Bank tab every teacher does -- full filters, search, and every question regardless of status (`renderBank()` branches on `isExternalReviewerUser` only to hide the "+ New Question" button, the "Only mine" filter, and each card's Edit/Locked button, not to replace the view) -- so they pick a question to review themselves, the same way a teacher picks one to read, rather than through a separate restricted screen. Every other nav tab is hidden for them client-side (an earlier version of this role had its own single "pick a random question" screen instead; that was replaced after feedback that reviewers need the normal filtered browsing experience, not a narrower one). In `renderDrawerBody()`, the Status section and Edit/Delete buttons are replaced with just a "Download as image…" button for this role, but the preview, peer-review section, and comment thread all render normally. Enforcement is server-side too, via a new `isContentTeacher()` function in `firestore.rules` (role in `["teacher","qb_lead","admin"]`) required for creating/editing questions and contests — `isTeacher()` (any of the four roles, including this one) still gates reads and comment-creation, since reading everything and commenting on anything (even locked) is exactly what this role is for. They're excluded from `pickReviewer()`'s balanced peer-review rotation and from the team comparison/leaderboard charts (`teacherComparisonData()`) — they don't author content or carry a quota. A comment from this role gets an "External Reviewer" badge in the thread (`reviewerBadge()` in `renderDrawerBody()`), and an admin viewing a **locked** question with such a comment sees an explicit callout prompting them to unlock it to act on the feedback.
- `role: "uploader"` (added Oct 2026) can only ever see the Upload tab — every other nav tab (including Bank) is hidden for them client-side, and `checkTeacherStatus()` forces `currentTab = "quilgo"` on sign-in since Bank, the app's normal default landing tab, isn't reachable for this role at all. Within Upload they can do everything the tab already offered any teacher — browse by category/day/slot, download a question's image, mark it uploaded/undo — no new UI was needed for that, since those actions were never `isAdminUser`-gated to begin with. Only "Mark this contest's upload complete" stays admin-only. Server-side, a new `isUploadOnlyChange()` in `firestore.rules`' `contests` match block allows any approved teacher (this role included) to update *just* `uploadStatus`/`quilgoComplete` on a contest, while creating a contest or changing any other field still requires `isContentTeacher()`. Excluded from `pickReviewer()` (allowlisted by role, not denylisted — see below) and from the team comparison/leaderboard charts, same reasoning as `external_reviewer`.
- `role: "automation"` (added Oct 2026) is for non-human service accounts — e.g. `backupFirestoreToDrive.gs`'s dedicated login — that need to read (and, if ever useful, write) exactly like a `teacher` but shouldn't clutter anything that lists "who's actually producing." No client-side UI hides any nav tab for this role (it behaves exactly like a plain `teacher` if anyone ever does sign in with it through the website, which it isn't meant to) — the whole point is server-side-equivalent authority (`isContentTeacher()` in `firestore.rules` includes it alongside `teacher`/`qb_lead`/`admin`) with client-side exclusion from `teacherComparisonData()`/`teamAverageToday()` (now an allowlist, see the data-model section below) and the Assignment tab's Kanban board (filtered out before building columns — nobody should be able to drag a chapter onto a service account). It still appears normally in Admin → Manage teachers.
- `role: "student_reviewer"` (added Oct 2026) is for someone who reviews student exam submissions for integrity **only** — no authoring access. Full details, including how this interacts with the separate `isStudentReviewer` boolean, are in the next bullet.
- Reviewing students (integrity review of exam submissions, NOT peer review of questions) has **two separate on-ramps**, for two different people:
  - `isStudentReviewer: true` (added Oct 2026, part of the post-processing pipeline) is a boolean on any teacher doc, independent of whatever `role` they already have, so one person can be e.g. `role:"teacher"` AND a student reviewer at the same time ("one person, two jobs" — deliberately not a `roles[]` rework, see the data-model section's `teachers/{email}` entry for why). Toggled via a checkbox in Admin → Manage teachers. Keeps every tab their real role already gave them, PLUS "Review Students".
  - `role: "student_reviewer"` (added Oct 2026) is a 7th, dedicated role value for someone who reviews students **only** — no authoring duties, no Bank access at all. Picked from the same role dropdown as any other role (Admin → Manage teachers → Create account, or the existing account's role selector). `isContentTeacher()` in `firestore.rules` does NOT include this role, so they can never create/edit questions or contests server-side, not just client-side.
  - Both land on the exact same client global, `isStudentReviewerUser` (`true` if EITHER condition holds) and the exact same `isStudentReviewer()` function in `firestore.rules` (`true` if EITHER condition holds) — server-side, its holder can update ONLY the review-outcome fields (`integrityFlags`/`meritStatus`/`reviewStatus`) on an `examSubmissions` doc, regardless of which on-ramp granted it.
  - A separate client global, `isStudentReviewerOnlyUser` (`true` only for `role==="student_reviewer"`, never for the boolean-flag case), is what actually restricts the nav — same "one tab, no exceptions" treatment `isUploaderUser` already gets for Upload: every OTHER tab hidden, `currentTab` forced to `"reviewstudents"` on sign-in, and the gamify bar (authoring-focused — streak, daily target, team comparison) hidden too, since none of it applies to someone who never authors a question. A plain teacher who ticked the `isStudentReviewer` checkbox is NOT affected by any of this — `isStudentReviewerOnlyUser` stays `false` for them, so they keep full teacher access plus the one extra tab.
  - Excluded, by the same role-string check in both places, from: `pickReviewer()`'s peer-review rotation and `teacherComparisonData()`'s leaderboard (both already allowlist `role in ["teacher","qb_lead"]`/admin-with-activity, so `student_reviewer` is excluded by omission, no code change needed there) and the Assignment tab's Kanban board (`allTeachers.filter(t=>t.role!=="automation" && t.role!=="student_reviewer")` — explicit exclusion needed here since that filter is a denylist, not an allowlist).
  - `.pill.role-student_reviewer` (red) in the CSS token set, `ROLE_LABEL.student_reviewer = "Student Reviewer"`, and an option in both the "Create account" role select and the per-row role-change select in Admin → Manage teachers — all driven off the one `ROLE_LABEL` map, so adding the entry there was the only change those two selects needed.

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
  solutionImage (data-URL or null, Oct 2026) -- optional image attached to
  -- the solution (e.g. a worked diagram), compressed client-side the same
  -- way graphicImage/option images are (fileToCompressedDataUrl()) and
  -- counted in the editor's total-image-size budget check alongside them.
  -- Deliberately separate from graphicImage (the question's own figure):
  -- this one only ever renders next to solutionEn -- the editor's live
  -- preview, the drawer's Solution section, openReviewForm()'s post-
  -- reveal step, and the Contests print view's Solution Manual -- and,
  -- like solutionEn's own text, only inside questionPreviewHtml()'s
  -- includeAnswer block, so it's never baked into the exam-facing "Final
  -- preview"/downloaded image unless a caller explicitly asks for the
  -- answer included (same exam-safety reasoning as the revealAnswer note
  -- below). No fixed width/position controls like the question figure
  -- has -- just upload/preview/remove, rendered at a fixed display width.
  level[] (subset of PMC-4/5/6/7), qType (aptitude|iq_puzzle|math_puzzle),
  difficulty (medium|hard|very_hard), unit (chapter code, e.g. "B3-C1"), subtopic,
  skills: [skillName, ...],   -- "skill tested" -- the transferable problem-
  -- solving technique (e.g. "Pattern Recognition", "Pigeonhole Principle"),
  -- distinct from unit/subtopic (content topic). Available list = a
  -- hardcoded DEFAULT_SKILLS seed (researched against how AMC 8/MATHCOUNTS
  -- categorize problems for this age band) unioned with every skill
  -- already used across questions (allSkills() in index.html) -- any
  -- teacher can add a new one from the editor, no admin step, no separate
  -- Firestore collection. Editor UI (Oct 2026): switched from a flat wall
  -- of click-to-toggle chips over every skill in the system to a
  -- dropdown-to-add pattern -- the chip row now shows only what's already
  -- selected on this question (each removable via its own ×), and the
  -- <select> only lists skills not yet selected (populateSkillSelect() in
  -- openForm(), called after every add/remove) -- the flat wall stopped
  -- being readable once the skill list grew past the DEFAULT_SKILLS seed.
  -- The free-text "type a new skill" input is unchanged.
  usedIn: [contest name, ...],   -- NOTE: `uploadedToQuilgo` (bool) is deprecated/removed
  -- from the UI — Quilgo upload status now lives on contests/{id}.uploadStatus
  -- instead (see below), since "uploaded" only makes sense per contest paper.
  -- Old docs may still carry a stray uploadedToQuilgo field; it's just ignored.
  likes: [teacherEmail, ...],   -- a lightweight ♥ toggle, separate from the
  -- 5-star rating below; arrayUnion/arrayRemove, allowed even on a locked
  -- question (see isMetadataOnlyChange() in firestore.rules).
  peerReview: { reviewerEmail, reviewerName, assignedAt, submittedAt,
    reviewerOptionId, reviewerNote, reviewTimeMinutes, outcome,
    issueFlag, issueNote } | null,
    -- added Oct 2026. Auto-assigned (pickReviewer() -- random among
    -- whoever has the fewest reviews EVER ASSIGNED to them lifetime, any
    -- outcome, i.e. balanced load, not round-robin) the moment status is
    -- set to "in_review" and no peerReview exists yet. Fixed Oct 2026
    -- after a real report of one teacher ending up with noticeably more
    -- reviews than everyone else: this used to count only
    -- outcome==="pending" as load, which balances CURRENT QUEUE DEPTH,
    -- not lifetime total -- a reviewer who cleared their queue quickly
    -- cycled straight back to load 0 and kept getting picked again, so a
    -- fast responder racked up far more TOTAL reviews over time than a
    -- slow one (whose growing pending backlog perversely protected them
    -- from further assignment). Now counts every review ever assigned
    -- regardless of current outcome, computed fresh from live `questions`
    -- state on every call (not a persisted counter), so taking a review
    -- away from someone (admin's "Take back" in Pending reviews) lowers
    -- their load back down immediately. Candidates are allowlisted by role (teacher or
    -- qb_lead only -- never admin/external_reviewer/uploader, and any
    -- future role is excluded by default instead of needing to be added to
    -- a denylist), AND must already have an assigned chapter quota
    -- somewhere (assignments.quotas) -- by request, someone with no
    -- assignment at all isn't part of this rotation. outcome is "pending" until the reviewer
    -- submits (openReviewForm()), then "agree" or "disagree" depending on
    -- which REVIEW_FLAGS entry they pick (see below) -- also auto-posts an
    -- explanatory comment when the outcome is "disagree". allowedStatusOptions() removes "finalized"
    -- from the status dropdown entirely -- not just a soft warning --
    -- until outcome is "agree", for every role including admin. Editing a
    -- "disagree" question resets peerReview to "pending" for the *same*
    -- reviewer (continuity) rather than picking someone new. No rules
    -- change needed for any of this -- the existing question-update rule
    -- already lets any teacher write to a non-finalized question
    -- regardless of authorship, which is exactly what a reviewer updating
    -- someone else's question needs.
    -- Review flow (Oct 2026 rewrite): openReviewForm() is now two steps,
    -- not one blind submit. Step 1 is unchanged in spirit (pick your own
    -- answer blind, optional working/solution text, optional time) but now
    -- also shows the question's full context up top -- level/type/
    -- difficulty/skills tags plus author name, createdAt/updatedAt, and
    -- chapter/subtopic -- so the reviewer knows what the question is
    -- actually for before solving it (previously only the bare prompt
    -- showed, via questionPreviewHtml(q,{includeOptions:false})). "Your
    -- working/solution" and "Time taken" are explicitly labeled optional
    -- and were never actually required client-side either, so this is a
    -- labeling fix, not a validation change. Clicking "Continue" reveals
    -- step 2: the marked answer + author's solutionEn side by side with
    -- what the reviewer answered, THEN a REVIEW_FLAGS radio pick (top-level
    -- const in index.html) -- "✅ OK — reviewed, ready to lock" (outcome
    -- "agree") or one of four specific issue flags ("Ambiguous wording",
    -- "Wrong answer marked", "Multiple solutions possible", "Other issue"
    -- -- all outcome "disagree") plus an optional note. The outcome is now
    -- the reviewer's own informed call made AFTER seeing the solution, not
    -- an auto-computed match between reviewerOptionId and correctOptionId
    -- (a reviewer can still get their own blind answer "wrong" yet
    -- correctly judge the question itself is fine, or vice versa).
    -- issueFlag stores which REVIEW_FLAGS.v was picked (null until
    -- submitted); issueNote is the reviewer's free-text note. The
    -- auto-posted comment on a "disagree" now reads "Review — <short
    -- label>: <note>" instead of the old hardcoded "I solved this as X but
    -- the marked answer is Y" text -- REVIEW_FLAGS.short is the no-emoji
    -- label used there and in the drawer's peer-review summary card.
    -- outcome stays binary agree/disagree under the hood specifically so
    -- every existing lock-gating/progress-counting call site (countByStatus,
    -- allowedStatusOptions, the status-track's lock button, teacherComparisonData,
    -- the donut on the Bank tab rail) needed zero changes.
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
    -- Picker eligibility (Oct 2026, explicitly discussed and confirmed with
    -- the project owner before changing -- see the "Access control model"
    -- warning above): openContestForm's `eligible` filter now also admits
    -- a "reviewed" question (status "in_review" AND peerReview.outcome
    -- "agree") alongside finalized/uploaded -- not just locked ones.
    -- Deliberately does NOT touch the Lock step itself: locking (QB Lead/
    -- Admin sign-off, isQBLeadOrAdmin() in firestore.rules) still works
    -- exactly as before, still the only way to stop a question's content
    -- from being edited further. This only widens which questions can be
    -- PICKED for a paper -- a peer-reviewed-and-agreed question no longer
    -- has to sit waiting on a separate lock click before it's contest-
    -- eligible. Each picker row now shows a status pill (via
    -- questionStatusInfo()) so an admin can tell "Locked" from "Reviewed
    -- OK" at a glance while choosing. Known tradeoff, not a bug: a
    -- "Reviewed OK" question added to a contest this way is NOT locked --
    -- its author (or anyone with isContentTeacher()) can still edit it
    -- afterward, unlike a genuinely locked one, since nothing about adding
    -- a question to a contest changes its `status`. If a paper needs to be
    -- frozen from further changes, lock each question first -- picking a
    -- "Reviewed OK" one doesn't do that automatically.
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
  role: "teacher" | "qb_lead" | "admin" | "external_reviewer" | "uploader" | "automation"
  -- "automation" (Oct 2026) is for non-human service accounts -- e.g. the
  -- backupFirestoreToDrive.gs account -- with the exact same read/write
  -- authority as "teacher" (isContentTeacher() in firestore.rules treats
  -- them identically) but excluded from anything that aggregates "who's
  -- actually producing": teacherComparisonData()/teamAverageToday() (now
  -- an allowlist -- role is teacher/qb_lead unconditionally, or admin only
  -- with actual activity/a quota -- so automation and any future
  -- non-producing role are excluded by default, not via a denylist entry
  -- that has to be remembered each time) and the Assignment tab's Kanban
  -- board (allTeachers.filter(t=>t.role!=="automation") before mapping
  -- columns -- nobody should be able to drag a chapter onto a service
  -- account). Still shows up normally in Admin -> Manage teachers (an
  -- admin needs to see/manage the account) and still passes isTeacher()
  -- for reads everywhere, same as any other role.

curriculumExtra/{entryId}    -- admin-added books/chapters PLUS (Oct 2026)
  teacher-added subtopics, merged into allCurriculum() at read time with
  the hardcoded CURRICULUM constant.
  type: "book"     -- {bookId, bookName, levels[], age, chapters:[]}
  type: "chapter"  -- {bookId, code, title, subtopics[]}
  type: "subtopic" -- {bookId, chapterCode, subtopic} -- appends one
    subtopic string to an existing chapter's `.subtopics` array (hardcoded
    or custom) without ever touching the chapter's own doc/data. The only
    type any content-teacher (not just admin) can create or update --
    firestore.rules checks `request.resource.data.type == "subtopic"` --
    so subtopics can grow collaboratively while books/chapters, and
    deletes of anything, stay admin-only.
  type: "chapter_edit" -- {bookId, code, title, subtopics[]} -- added Oct
    2026 so EVERY chapter is editable, not just admin-added ones: this is
    what makes a hardcoded Beast Academy chapter's title/topics editable
    even though it has no curriculumExtra doc of its own to update.
    allCurriculum()'s merge applies this as a full REPLACE of the matched
    chapter's title+subtopics (by `code`, found anywhere in the already-
    merged tree -- hardcoded or custom), run BEFORE the "subtopic" append
    pass so a teacher's "+ New subtopic" addition always survives on top
    of an override regardless of which happened first chronologically (an
    override is a static snapshot; if it ran last it could silently hide a
    newer append on every re-render). `code`/`bookId` are never editable
    (same reasoning as "chapter" below); `title`/`subtopics` are freely
    rewritten, including removing or renaming an originally-hardcoded
    topic, not just adding new ones.
  createdAt, createdBy
  -- Admin & Analytics -> Curriculum has an "Edit any chapter" picker (Book
  -- + Chapter selects, builds a synthetic entry from the CURRENT merged
  -- chapterByCode() so the form always shows what's actually displayed
  -- right now) alongside the "Added entries" table's per-row Edit/Remove.
  -- openCurriculumEditForm() in index.html handles both a real doc (has
  -- .id -- updateDoc, works for "chapter" and "chapter_edit" alike, the
  -- Added-entries table normalizes a clicked "chapter_edit" row's `type`
  -- to "chapter" first since the form/save logic treats them identically)
  -- and a synthetic one with no .id (first-ever edit of a pure hardcoded
  -- chapter -- addDoc's a new "chapter_edit" instead). Saving a chapter
  -- edit also deletes any standalone "subtopic" docs for that chapterCode
  -- (folds them into the one saved list) so there's a single source of
  -- truth for the chapter's topics afterward, not two that could drift.
  -- `code` is deliberately NEVER editable anywhere in this form (shown
  -- disabled, with an explanatory hint) since existing questions
  -- reference it directly via `unit`; renaming it out from under them
  -- would silently orphan those questions' chapter tag the same way
  -- deleting the entry does. No firestore.rules change was needed for any
  -- of this -- `isAdmin()` already permits create/update/delete on this
  -- collection regardless of `type`.

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
roster rows, the Workload level cards, the rail's assignment bars). In
barChartSvg() (per-level, still a stacked column chart) a bar-reviewed
segment (green -- see the recolor note below) renders this as a 4th
stacked segment, between "locked" and "in review".

Per-teacher comparison chart (Oct 2026 rewrite -- `teacherGroupedBarSvg()`,
replacing the old `hBarChartSvg()`): was one horizontal STACKED bar per
teacher (segments concatenated end to end), which made comparing e.g. "how
many in review" across different teachers require eyeballing segment
lengths inside each bar. Now each teacher gets a cluster of separate
vertical bars -- draft/inReview/reviewed/done/reviewsDone -- all on one
shared height scale (`maxVal` across every teacher and metric), so a bar's
HEIGHT alone tells you how that teacher compares to everyone else on that
specific metric, not just within their own cluster. `reviewsDone` (how
much of a teacher's reviewING workload -- reviewing OTHER people's
questions -- is done) is its own 5th bar, not folded into the authoring
breakdown, since authoring and reviewing are different jobs;
`teacherComparisonData()` already computed this field, just wasn't
charting it as its own bar before. Used at both call sites: the Bank tab
rail's "Team" card (narrow, initials-only labels) and the Admin tab's "By
teacher" card (wide, full names) -- same function, different `{W, rowH,
labelFontSize}` opts, same shrink-to-fit-container approach as
`barChartSvg()` (bar width shrinks as teacher count grows, chart never
overflows its viewBox).

Status bar colors (Oct 2026 recolor, `.bar-*` CSS classes): draft=red,
in review=brown (new `--brown`/`--brown-soft` theme tokens, both light and
dark), reviewed=green (`--accent`), locked=blue. This swapped the original
draft=blue/in-review=gold/reviewed=violet/locked=accent(green) mapping --
violet is now free and reused for `.bar-reviewsdone` (the reviewing-
workload bar above), kept visually distinct from the authoring-status
colors on purpose. Since colors live on the CSS class, not the call site,
every existing user of these classes (the donuts, `barChartSvg()`,
`teacherGroupedBarSvg()`) picked up the new colors automatically -- no
call-site changes needed beyond the two legends that list swatch+label
pairs by hand.

Peer-review queue navigation (Oct 2026): a reviewer with several pending
reviews is no longer funneled through them one at a time, always starting
with whichever `pendingReviewsFor()` happened to return first.
`openReviewForm(q)` now shows "Review X of N assigned to you" with ←
Previous/Next → buttons that walk the SAME queue (sorted oldest-assigned-
first) in either direction. Separately, `openMyReviewsPanel()` (opened via
the Bank tab rail's "Reviews" card -- button now always present, not just
when something's pending) lists a reviewer's own two buckets as tabs: "To
review" (pending, click opens `openReviewForm()`) and "Reviewed" (already
submitted, click opens the normal drawer via `openQuestion()` so they can
see it in context) -- same split `myReviewStats()` already counted for the
donut, now browsable as an actual list instead of only a count.

Reviews progress pie (Oct 2026, part of the same pickReviewer() balancing
fix above): the rail's "Reviews" card donut used to only break down
already-COMPLETED reviews by OK/sent-back (`rv.agree`/`rv.disagree`),
with pending work visible only as a count on the "N to do" button --
nothing showed assigned-vs-done at a glance the way the "Your questions"
donut right above it does for authoring. The donut now plots
done(`rv.total`)-vs-assigned(`pending.length`) as its two segments
(label "done"), with the OK/sent-back split kept as a second legend line
underneath -- so a teacher's own view has both progress pies (questions
authored, reviews assigned+done) visible together, side by side, per
explicit request.

"Sent back" visibility for the author (Oct 2026): previously a reviewer's
"disagree" only ever surfaced once the author happened to open that
specific question (its drawer's peer-review card, or the editor's warning
callout) or noticed the auto-posted comment -- nothing on the dashboard or
the Bank tab's card list distinguished "sent back, needs you" from a
question still just sitting with its reviewer. Fixed with two additions,
both keyed off `q.peerReview?.outcome==="disagree"`: (1) a red-bordered
"Sent back (N) — needs your fix" card, first in the Bank tab rail (ahead
of "Your assignments" -- the most time-sensitive thing there), listing
every one of the author's own flagged questions with its specific
`REVIEW_FLAGS` reason and a button straight into `openForm(q)` to fix it;
omitted entirely when N is 0 so a clean author never sees it. (2)
`cardHtml()` now adds a small red "⚠ {reason}" pill next to the status pill
on ANY flagged question's row in the Bank tab list (not just the rail,
and visible to anyone browsing, not only the author -- useful for
admins/QB Leads scanning too), using the same `REVIEW_FLAGS.short` lookup
the drawer/editor already use for this.

Peer-review feedback as comments, and a "Reviewed OK" status tag (Oct
2026): two related gaps, fixed together. First, `openReviewForm()`'s
submit handler previously only posted an auto-comment for a "disagree"
outcome, and even then it never included the reviewer's own working
(`reviewerNote`) or time taken (`reviewTimeMinutes`) -- both were captured
into `peerReview` but never actually shown to the author anywhere. It now
posts a comment for EVERY outcome (agree included), with the reviewer's
working and time taken appended when provided, tagged `kind:"peer_review"`
+ `reviewOutcome:"agree"|"disagree"` on the comment doc itself (no rules
change needed -- `questions/{id}/comments` already allows any field on
create). Every comment-rendering site (`renderDrawerBody()`'s thread,
`renderCardEngagement()`'s Bank-tab-card preview, and the editor's new
read-only comments section below) checks `c.kind==="peer_review"` to apply
a colored left-border + "Peer review: OK/Flagged" badge (`.comment-card`/
`.card-comment` `.review-agree`/`.review-disagree` CSS), distinct from an
ordinary freeform comment -- including the existing "External Reviewer"
role badge, which stacks alongside it if that's who posted it. Because
these are ordinary comments (not overwritten the way `peerReview` itself
is on a resubmit), the full history survives in the thread even after a
second review cycle replaces the `peerReview` object: an old "Flagged:
..." comment and a later "Reviewed OK" comment both stay visible,
chronologically, so anyone opening the question can see it was flagged,
then fixed, then approved -- not just its current state. `.comment-txt`/
`.card-comment` gained `white-space:pre-wrap` since these comments are
now multi-line (`escapeHtml()` already preserves literal `\n`, no `<br>`
conversion needed).

Second, `questionStatusInfo(q)` (new, next to `matchesStatusFilter()`) is
the same "reviewed" derivation used for the status filter, now also used
for every status PILL display (`cardHtml()`'s card, `renderDrawerBody()`'s
tag line) instead of each reading `STATUSES` directly off raw `q.status`.
Filtering the Bank tab by "Reviewed — ready to lock" used to still show
"In Review" on every matching card (the pill read `q.status`, which
genuinely is still `"in_review"` until a QB Lead locks it) -- looked like
the filter was broken. New `.pill.status-reviewed` CSS class (violet,
matching `backup-viewer.html`'s existing one of the same name) backs the
"Reviewed OK" label this produces. The editor's actual `<select
name="status">` is untouched -- "reviewed" still isn't a real status
value, only ever a derived display label.

The editor (`openForm()`, Edit mode only) also gained a read-only
"Comments" section in step 4, right where the existing "Reviewer flagged"
callout already said "see the comments below" -- previously true nowhere,
since the editor never showed comments at all and an author fixing a
flagged question had to keep the View drawer open in a second tab/window
to read the feedback. One-shot `getDocs` fetch (not a live subscription --
same reasoning as `loadCardEngagement()`'s one-shot fetch, this modal's
lifetime is short), same comment-card markup/badges as the drawer. Replying
still only happens from the drawer -- the editor's copy is explicitly
labeled read-only, so there isn't a second, out-of-sync place comments get
posted from.

studentRoster/{formB}_{sittingKey}   -- Oct 2026, Post Processing tab, Phase 1
  of the post-exam pipeline (Item Analysis + Student Performance -- see
  below). A pre-exam roster CSV (Form B, Name, District, School, Father
  Name columns -- resilient header matching via findColIndex(), not exact
  string matching, since this is hand-built by the admin) imported with
  PMC type/day/slot picked once in the UI and applied to every row --
  sittingKey = `${pmcType}_D${day}_S${slot}`. Doc ID is Form-B+sittingKey
  so re-importing a corrected file for the same sitting safely overwrites
  rather than duplicating. Form B is the student's unique identifier
  project-wide -- the SAME 13-digit number appears as the local-part of
  their Quilgo login email (`<formB>@vss.com`), which is how a results
  import (below) joins back to this roster.
  formB, name, district, school, fatherName, pmcType, day, slot, importedAt, importedBy

examSubmissions/{contestId}_{formB}   -- Oct 2026, Phase 2 of the post-exam
  pipeline (results import + auto-flagging + the post-processing run that
  populates post_test stats -- see `renderResultsImport()`/
  `renderResultsImportBody()`/`renderItemAnalysis()` in index.html).
  One doc per student per contest sitting, parsed from the actual Quilgo
  CSV export client-side (parseCsv() in index.html -- a small hand-rolled
  RFC4180-ish parser, no library, verified against a real export:
  "PMC-5 (Summer 2025).csv" in this repo, 664 students, 1360 columns).
  Real volume per import is ~600-1,500 rows (not 10,000 -- that's the
  total across all 6 slots x 4 PMC categories combined), so parsing and
  batched writeBatch() calls (400/batch, under Firestore's 500 cap) happen
  entirely client-side -- no Apps Script relay for this part (that stays
  where it already is, for the hourly Drive backup, a different job).
  formB, email, name, district, school (the last two backfilled from the
  matching studentRoster doc at import time, when one exists),
  contestId, contestLevel, day, slot,
  score, scorePercentage, durationMinutes, completelyFilled,
  startedAt, submittedAt, trustScore, switchedTabsTotal (numeric, the
  summary-level column), facePresencePct, faceMatchPct, blankShots,
  multipleScreens, botDetection,
  answers: [{questionId, chosenLabel, result, score, switchedTabs (bool --
             Quilgo's PER-QUESTION column of this name is actually a
             Yes/No flag, not a count, unlike the summary-level total
             above; confirmed by reading the raw CSV values directly),
             suspiciousPatterns, suspiciousPhotos, suspiciousScreenshots}],
  -- answers[i].questionId is resolved from contest.questionIds[i] at
  -- import time (confirmed with the project owner: Quilgo's question
  -- column order matches the paper's print order exactly), SLICED to
  -- contest.questionIds.length -- the real Quilgo export reserves more
  -- question-column slots than a given paper actually uses (134 in the
  -- sample file vs. a real 30-question paper), so this slice is what
  -- keeps the padding from being misread as extra questions. Column
  -- blocks are detected by header LABEL (parseResultsHeader() in
  -- index.html, every "[Question]"-prefixed header cell, each field
  -- within a block found by label too, not fixed offsets) so minor
  -- column reordering across export batches doesn't silently misalign
  -- the import -- the Import results screen also shows an editable
  -- override table (defaults to positional) as a safety net. NOTE: in
  -- the sample file, the first 30 raw blocks don't line up 1:1 with 30
  -- real per-student answers (most students show far fewer than 30
  -- attempted among the first 30 blocks) -- the 134 blocks sit under 30
  -- "[Section]" markers with an uneven 3-5 blocks each, so the real
  -- question-to-block relationship for a given paper may not simply be
  -- "the first N in file order." Always check the override table against
  -- a couple of known students' real answers on a genuine import rather
  -- than trusting the positional default blindly.
  integrityFlags: {auto:[reason,...], manual:[{reason,by,byName,at}]},
  -- auto array is a SNAPSHOT computed at import time via computeAutoFlags()
  -- from settings/integrityThresholds (below); the Student Performance
  -- dashboard (Phase 3) recomputes the same function fresh from this doc's
  -- raw signal fields whenever an admin edits a threshold there, so
  -- "more than 10 tab switches, or any number" applies live without a
  -- reimport -- the stored snapshot is only a convenience for anything
  -- that reads it directly (the Review Students tab, badges). Quilgo's
  -- export has no literal "multiple faces" column -- confirmed with the
  -- project owner to use Face match %/Face presence %/Suspicious photos
  -- count as the closest automatic proxies, and leave anything the CSV
  -- can't catch to a human flagging it manually after checking Quilgo's
  -- own proctoring report for that submission.
  meritStatus: "eligible"|"excluded", reviewStatus: "unreviewed"|"assigned"|"cleared"|"flagged",
  -- meritStatus/integrityFlags.manual are written by the Student
  -- Performance dashboard's per-row Flag/Clear actions (Phase 3,
  -- `renderStudentPerformanceBody()` in index.html) -- Flag opens
  -- `promptFlagDialog()` (same #confirm-root/.overlay/.gate-card pattern
  -- as confirmDialog(), with a required reason textarea) and arrayUnion()s
  -- a {reason,by,byName,at} entry onto integrityFlags.manual while
  -- setting meritStatus:"excluded"; Clear only resets meritStatus back to
  -- "eligible" -- the manual flag HISTORY is never deleted, same
  -- "comments survive even after the state they describe changes" choice
  -- already made for peer-review comments above. reviewStatus moves
  -- unreviewed -> assigned (when a reviewAssignments batch is created,
  -- below) -> flagged|cleared (when that reviewer acts on it).
  rosterMatched (bool -- false if no studentRoster doc found for this formB+sitting),
  importedAt, importedBy

contests/{contestId}  -- gains resultsImportedAt, resultsImportedBy,
  submissionCount, set by the Import results screen's "Import results"
  button (Phase 2).

settings/integrityThresholds   -- single doc, admin-adjustable, same
  pattern as settings/limits. maxTabSwitches (default 10), minFaceMatchPct
  (default 50), minFacePresencePct (default 50), maxSuspiciousPhotos
  (default 3), flagOnTrustScoreLow/flagOnBlankShots/flagOnMultipleScreens
  (bool, default true) -- loaded once per session via loadIntegrityThresholds()
  (falls back to these same defaults if the doc doesn't exist yet, same
  "works with zero setup" pattern as settings/limits), used by
  computeAutoFlags() at import time. The Student Performance dashboard's
  threshold inputs (Phase 3) edit a SEPARATE in-memory copy
  (`ppStudLiveThresholds`) applied instantly client-side via the same
  computeAutoFlags() -- "Apply" just re-renders from that local copy, no
  write at all; "Save as default thresholds" is the only action that
  actually writes this settings doc (and updates the shared
  `integrityThresholds` global other code reads), for when an admin wants
  a threshold change to also apply to the NEXT import's stored
  `integrityFlags.auto` snapshot.

reviewAssignments/{assignmentId}   -- admin-created batches assigning
  flagged students to a specific student reviewer, written by
  assignSubmissionsToReviewers() from the Student Performance dashboard's
  integrity table (checkbox per row + an "Assign checked to reviewers"
  action, Phase 4). One doc per reviewer per batch (not one doc per
  student) -- balanced-random, same least-loaded/random-tie-break shape
  as pickReviewer(), except "load" here means each reviewer's total
  already-assigned submissionIds across every past batch (re-fetched
  fresh each time, not a live in-memory count). Three modes: "random"
  (each selected student goes to whichever reviewer currently has the
  least), "district"/"school" (group selected students by that field --
  backfilled from studentRoster at import time -- and send a whole group
  to one least-loaded reviewer, so one person handles one city/school's
  cases together) -- covers the project owner's explicit "randomly or
  city-wise or school-wise" ask.
  reviewerEmail, reviewerName, submissionIds:[...], mode, createdAt, createdBy
  -- submissionIds (examSubmissions doc ids, each already contestId+formB-
  -- scoped) instead of a single contestId + formBs list, since Student
  -- Performance can combine several sittings/levels in one view and a
  -- batch may legitimately span more than one contest.
  Assigning a submission also sets its examSubmissions.reviewStatus to
  "assigned" (same batch, atomic). "Review Students" (renderReviewStudents()/
  renderReviewStudentsBody()) is the reviewer-facing mirror: queries
  reviewAssignments where reviewerEmail==their own email, fetches each
  referenced examSubmissions doc, and offers the exact same Flag/Clear
  action the admin's integrity table uses (promptFlagDialog()/
  computeAutoFlags() shared verbatim) -- Flag also sets reviewStatus to
  "flagged", Clear sets it to "cleared", matching firestore.rules'
  isStudentReviewer() field allowlist exactly.

questions/{id}/stats/post_test (existing collection, see above) -- the
  Import results screen's "Run post-processing" button now populates this
  AUTOMATICALLY from real examSubmissions data (classic top/bottom ~27%
  item-analysis groups by total score) instead of the admin hand-typing
  six aggregate numbers into renderStatForm() -- same fields, same
  qualityLabel() formula, plus two additive fields (source:"csv_import",
  contestId) -- so the existing "Scored questions" table needed zero
  changes itself to start showing real computed numbers, and can be
  re-run any time (e.g. after fixing a question-column mapping) without
  re-importing the CSV.

teachers/{email}  -- gains isStudentReviewer: boolean (Oct 2026, additive --
  independent of the existing single `role` field, which stays completely
  untouched). One person can be e.g. role:"teacher" AND
  isStudentReviewer:true at the same time -- "one person, two jobs" without
  reworking `role` into an array (that was considered and explicitly
  rejected as higher-risk: it would touch every role check across the app
  -- isAdmin(), isContentTeacher(), isQBLeadOrAdmin(), isExternalReviewerUser,
  isUploaderUser, pickReviewer(), teacherComparisonData(), the Manage
  Teachers role dropdown, firestore.rules -- for one additive need).
  Toggled via a checkbox column in Admin -> Manage teachers -> Teacher
  accounts (`renderTeachersTable()`), `updateDoc(doc(db,"teachers",email),
  {isStudentReviewer})` -- no rules change needed, same "updateDoc merge
  preserves the existing role" reasoning as the inline name-edit feature.
  `isStudentReviewer()` in firestore.rules mirrors `isAdmin()`'s pattern,
  used only to gate examSubmissions' review-only fields (a reviewer can
  update integrityFlags/meritStatus/reviewStatus but nothing else on a
  submission -- they didn't import the data and shouldn't be able to touch
  scores/answers). Global `isStudentReviewerUser` in index.html (set in
  checkTeacherStatus(), alongside isAdminUser/isExternalReviewerUser/
  isUploaderUser) gates a new "Review Students" nav tab, hidden from
  external_reviewer/uploader same as every other tab those two roles don't
  get.

New nav tab "Post Processing" (admin-only, same client-side hide pattern
as the existing Admin tab -- `document.querySelectorAll('[data-tab=
"postproc"]').forEach(b=>b.hidden = !isAdminUser)` in checkTeacherStatus()).
Four inner sections via `postProcTab` state + `renderPostProcessing()`,
ALL FOUR now fully built (Phase 5, the plan's last phase, shipped Oct
2026): Import roster (Phase 1); Import results (Phase 2 --
`renderResultsImport()`/`renderResultsImportBody()`); Student Performance
(Phase 3+5 -- `renderStudentPerformance()`/`renderStudentPerformanceBody()`);
Item Analysis (Phase 2, rebuilt for Phase 5 -- `renderItemAnalysis()`/
`loadItemAnalysis()`/`renderItemAnalysisBody()`).

Student Performance: an admin ticks one or more sittings with imported
results (checkboxes, not a single cascading pick, since "combine all 4
PMC-4 slots" or "PMC-4 + PMC-5 merit" both just mean ticking more boxes),
"Load" fetches examSubmissions for those contestIds in chunks of 30
(Firestore `in` cap -- comfortably above this project's real max of 24 =
6 slots x 4 categories), cached in `ppStudSubs` for the rest of the tab
visit. Shows, in the order the project owner asked for: (1) an integrity
table -- only rows with at least one auto-flag, an existing manual flag,
or an existing exclusion, sorted by flag count -- with the threshold
inputs editable right above it and applied live via the SAME
`computeAutoFlags()` results import already uses (no reimport, no
Firestore write unless "Save as default thresholds" is clicked); each
row's Flag/Clear action writes `examSubmissions.integrityFlags.manual`/
`meritStatus` directly (matches firestore.rules' `isStudentReviewer()`
field allowlist exactly -- the Review Students tab's own Flag/Clear
writes through the exact same two fields); a checkbox per row plus
"Assign checked to reviewers" sends the ticked students through
`assignSubmissionsToReviewers()` (see the `reviewAssignments` entry
above) and is how students actually end up in someone's Review Students
tab; (2) Phase 5 additions, both pure read-only computations over the
already-loaded `ppStudSubs` (no new Firestore reads/writes) -- a score-
distribution histogram (`simpleBarSvg()`, bucketed by `scorePercentage`
in 10-point bands rather than raw score, since raw scores aren't
comparable once sittings with different total marks are combined) and a
"Top N performers — question breakdown" table (N capped at 20, not every
loaded submission, to keep the DOM light at real scale): of the top-N
non-excluded students by score, what % got each question right, sorted
worst-first so a question even strong students are missing stands out;
(3) a full merit list (score desc, excluded rows greyed out and skipped
in rank numbering, not deleted or hidden) with a CSV export
(`exportMeritListCsv()`, same Blob/`<a download>` pattern
`exportAllData()` already uses).

Item Analysis was REWRITTEN for Phase 5, not just extended: it now ticks
sittings the same multi-select way Student Performance does (own state,
`ppItemSelectedIds`/`ppItemSubs`), and computes p-value/discrimination/
quality LIVE in the browser from whichever sitting(s) are loaded, instead
of reading the stored `questions/{id}/stats/post_test` doc the way it did
through Phase 2. This is what makes "combine across slots" possible: tick
several sittings a question was reused across and its attempts/correct/
top/bottom pool together client-side before p/d is computed -- read-only,
nothing written to Firestore, so it does NOT disturb the stored
`post_test` docs "Run post-processing" (Import results tab) still writes,
which the pre-existing Admin "Scored questions" table still reads exactly
as before. Below the per-question table: two roll-up bar charts (average
discrimination by skill, average p-value by difficulty tier) and a plain
HTML skill x difficulty pivot table of average discrimination -- all
three derived from the same live-computed rows, no extra Firestore reads.
Known tradeoff, inherited from the identical choice already accepted for
Student Performance's combined merit list: when sittings with different
question sets are combined, a question only in some of them draws its
top/bottom-27% counts from whichever pooled-rank students happen to have
answered it, which can be a small/noisy sample -- not a bug, just how
combining differently-composed papers works.

`parseCsv(text)`/`findColIndex(header, candidates)` (roster) and
`parseResultsHeader(header)` (results -- label-based, not fixed-offset,
detection of every repeating Quilgo question-column block) are the
reusable CSV-shape-detection pieces, both verified directly against the
real Quilgo export file in this repo. Import results still uses the
single-sitting cascading category/day/slot picker
(`resolveContestPicker()`/`contestPickerHtml()`, factored out of the
pattern `renderQuilgo()` already used for the Upload tab) on its own
`ppResLevel/Day/Slot/ContestId` state -- only Item Analysis moved to the
multi-select pattern. `qualityLabel()` and the `questions/{id}/stats/
post_test` write shape are shared verbatim with the pre-existing manual
`renderStatForm()` entry path -- the Admin tab's "Scored questions" table
doesn't care which path populated a question's stats, and nothing about
Phase 5 changes what that path writes.

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

The Bank tab's status filter (`#f-status`) is driven by `BANK_STATUS_FILTERS`, not `STATUSES` directly (Oct 2026) — it's the same four raw status values PLUS one derived "Reviewed — ready to lock" option (`matchesStatusFilter(q, "reviewed")` → `q.status==="in_review" && q.peerReview?.outcome==="agree"`), so admins/QB Leads can isolate exactly the subset of in-review questions a reviewer already agreed with and is just waiting on a lock. This is additive: the plain "In Review" filter option and every status-pill quick-filter (clicking a card's own status pill) still match ALL `in_review` questions regardless of review outcome, exactly as before — `STATUSES` itself (used by the editor's actual Status field and card status pills) is untouched.

The `Download as image…` affordance aside, `renderDrawerBody()`'s peer-review summary card and the editor's "disagree" callout both surface the specific `REVIEW_FLAGS` label (e.g. "Ambiguous wording") instead of a generic "Disagrees" — look up `REVIEW_FLAGS.find(f=>f.v===q.peerReview.issueFlag)?.short` if touching that copy.

Images (question figure + per-option images) are stored **inline on the Firestore document as compressed JPEG data-URLs**, not in Firebase Storage — a deliberate choice to stay on the free Spark plan (Storage now requires Blaze billing even for free-tier usage). `fileToCompressedDataUrl()` in `index.html` resizes/compresses client-side before writing, with a soft ~250KB-per-image budget so a question with several option images stays under Firestore's 1MB/doc cap. The Print/Export view can also shuffle each question's option order per printout (anti-copying) — grading stays correct either way because correctness is tracked by `correctOptionId`, never by array position.

**`questionPreviewHtml()`'s `revealAnswer` defaults to `false` — do not change this back to `true`.** Fixed Oct 2026 after a real bug report: this shared box backs BOTH the drawer's "Final preview" (labeled "exactly what Download as image produces") and the actual image `downloadQuestionImage()` exports for Quilgo upload into the live exam, so a `✓` marked next to the correct option here was baked directly into the exam image itself, visible to every student. No current caller needs the correct option marked inline — the Contests print view's separate Answer Key section and `openReviewForm()`'s own post-reveal markup already cover every legitimate "show me the answer" need without touching this shared box, and `includeAnswer`'s separate boxed "Answer" section (still off by default, unrelated to this flag) remains available for a future caller that explicitly wants one. If a new feature genuinely needs the correct option marked inline in this specific box, pass `revealAnswer:true` at that one call site — never flip the default, since the drawer preview and the exported image must stay exam-safe by default.

**MathJax output mode is SVG (`tex-svg.js`), not the CHTML combo (`tex-mml-chtml.js`) — do not switch this back.** Fixed Oct 2026 after a real bug report of equations rendering garbled/doubled in downloaded images: html2canvas cannot reliably capture MathJax's rendered output directly (confirmed by testing — the live on-page rendering was pixel-perfect; only an html2canvas-captured canvas ghosted every equation, with CHTML and SVG output alike, regardless of `scale`/`letterRendering`/`foreignObjectRendering` options). The actual fix is `flattenMathToImages()` in `index.html`, called in `downloadQuestionImage()` right after `MathJax.typesetPromise()` and before `html2canvas()`: it walks every rendered `mjx-container svg`, serializes it to a data-URL, and replaces the container with a plain `<img>` — html2canvas draws a plain image via `drawImage()` instead of trying (and failing) to re-interpret MathJax's deeply-nested inline layout itself. This needs real `<svg>` elements to serialize, which is why the output mode had to move off CHTML (font-glyph-based, no equivalent `<svg>` per expression) to SVG. Separately, a multi-line `commonEquation` (a teacher pressing Enter between several equations) used to get wrapped as one `$$...$$` block — MathJax has no concept of a bare newline as a line break in math mode, so every line ran together with no separation, compounding the garbled look. `commonEquationHtml()` now splits on newlines and gives each non-empty line its own `$$...$$` block; use it (not a raw `$$${commonEquation}$$` wrap) at all three render sites (editor live preview, `questionPreviewHtml()`, Contests print view) if this is ever touched again.

**`.overlay`/`.drawer` are now a centered modal dialog, not a right-edge sliding side panel.** Changed Oct 2026 after real feedback: the old `.overlay{ justify-content:flex-end }` + `.drawer{ height:100vh }` pattern (1) left too little width for the question "Final preview" (whose whole point is to show exactly what gets downloaded/exported) to render at a readable size, and (2) `confirmDialog()` reuses the same `.overlay` for small popups like "Delete this question?", which were getting shoved to the screen's right edge along with it instead of appearing as a small centered rectangle. `.overlay` is now `inset:0` with `align-items:center; justify-content:center`; `.drawer` dropped `height:100vh` for `max-height:88vh` (scrolls internally if content overflows) and widened from `min(560px,100vw)` to `min(720px,94vw)` (`.drawer.wide` stays `min(980px,94vw)`, just swapped `100vw`→`94vw` for consistent edge breathing room). `.editor-page` (the full-page question editor, a deliberately different full-screen pattern for a multi-step form) is untouched. Every caller of `.overlay`/`.drawer`/`confirmDialog()` picked up the new centered behavior automatically — no call-site changes needed, including for the External Reviewer role, which goes through the exact same `renderDrawer()`/`renderDrawerBody()` path as everyone else, so it gets the same centered, exam-accurate preview too.

**Long admin tables are now collapsed by default behind `<details class="records-details">`, not rendered open inline.** Added Oct 2026 after a real report that "Pending reviews" alone (191 rows at the time) made the Admin & Analytics page unusably long. Wrapped: Pending reviews, Curriculum's "Added entries" table, Scored questions, and Activity log (all closed by default) — Manage teachers' "Teacher accounts" table uses the same component but stays `open` by default since it's checked often right after creating/editing an account. `.records-details` already existed (the Assignment tab's "All assignment records" used it first) so no new CSS was needed, just reuse. Async population (`subscribeActivityLog()`, `loadAllStats()`, the teachers `onSnapshot`) still works correctly into a closed `<details>`'s content — `innerHTML` writes don't care about open/closed state, only visibility does.

**Teacher names can now be edited after account creation** (new `[data-edit-name]`/inline `<input>` in `renderTeachersTable()`, Admin → Manage teachers → Teacher accounts) — previously `name` could only ever be set once, by typing it into "Full name" at `addTeacher()` time; an account created with that field left blank (or from before it existed) had no way to fix it afterward, so every `t.name||t.email` fallback across the app (Assignment Kanban column headers, the Team/By-teacher chart labels, reassign dropdowns) permanently showed the raw email instead of a name. Click the ✎ next to a name to edit inline; `updateDoc(doc(db,"teachers",email), {name})` — no rules change needed, the existing `teachers/{email}` update rule already allows an admin to write any field as long as `role` stays valid, which an `updateDoc` merge preserves automatically.

## Files in this repo

- `index.html` — the entire app (UI + Firebase config + all logic). Real Firebase config values are already filled in (project `pmc-qb`) — not placeholders.
- `firestore.rules` — security rules, kept in the repo as the source of truth; must match what's actually published in the Firebase console (they can drift — the console is the live copy).
- `SETUP.md` — full click-by-click setup walkthrough (GitHub Pages + Firebase project creation, auth, Firestore, rules, teacher allow-list, auto-deploy). Written for a non-technical project owner, not a developer — verbose and screenshot-oriented in tone.
- `.github/workflows/deploy-firestore-rules.yml` — GitHub Action that deploys `firestore.rules` to Firebase automatically on push, **if** two repo secrets are set (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`). As of this writing it's unconfirmed whether those secrets were ever actually added — check before assuming this is live; if not, rules changes still need manual console paste.
- `PMC_Examination_SOP_v2.pdf` — the real official SOP; transcribed into the app's own "SOP" tab and into the difficulty/options-construction callouts in the question editor (`DIFFICULTY_SOP`/`OPTIONS_CONSTRUCTION_NOTE` in `index.html`). If this PDF is ever revised, those transcriptions need updating too — they're not generated from the PDF at runtime.
- `design-reference/` — prototype/source-art files (`pmc_4_v1.html`, a bubble-answer-sheet prototype, the logo's Illustrator source) kept for design reference, not runtime assets. `sundarstem_logo.png` stays at the repo root since `index.html` references it directly.
- `backup-viewer.html` — a standalone, read-only viewer for a backup JSON file (the kind the Admin tab's "Export all data" button produces). Still no Firebase imports and no writes anywhere — open it directly as a local file in any browser if the live site/Firestore is ever unreachable. Deliberately separate from `index.html`. As of Oct 2026 it does load MathJax + html2canvas from the same CDN URLs as `index.html` (the one exception to "no network calls"), gated behind its **Upload status** tab's "Download image…" button — every other tab (Questions, Contests, Assignments, Teachers, Curriculum) still works with zero network access. This exists for the actual real-world failure mode the file is for: Firestore is down, but a locked question in a contest still needs to reach Quilgo for the live exam. Ported from `index.html` (kept in sync manually, not generated): `FONT_LIBRARY`, `renderRichText()`, `commonEquationHtml()`, `optionsLayoutClass()`, `getQuestionOptions()`/`getCorrectOptionId()`, `questionPreviewHtml()` (trimmed -- no `includeAnswer`, and `revealAnswer` isn't exposed as a param at all here since this file has no caller that would ever want it `true`), `flattenMathToImages()`, `downloadQuestionImage()` (adapted to take a plain object instead of touching Firestore), and the MathJax `window.MathJax = {...}` inline-math config that MUST load before the MathJax script tag (easy to forget when porting -- without it, every `$x^2$`-style question silently fails to typeset, since MathJax v3 doesn't recognize single-`$` delimiters without this config). The **Upload status** tab (`renderUploadStatus()`) mirrors `index.html`'s `renderQuilgoBody()`: one card per contest (contests with something still pending float to the top and start expanded), each showing pending-vs-already-uploaded questions cross-referenced against `data.questions` by id, with a status pill per question (via `questionStatusInfo()`, same derived "Reviewed (awaiting lock)" as the live app's 4-way breakdown) and a Download button. There's no "mark uploaded" here -- this file can't write anywhere -- so marking still happens in the live app once it's back; this view is purely "get the image out" in the meantime. As of Oct 2026 the **Questions** tab also has real filters -- level/type/difficulty/status (`STATUS_FILTERS`, same "reviewed" derived option as `BANK_STATUS_FILTERS` in `index.html`)/chapter/skill/author/date-range/sort/search, all driven by `qFilters` + `filteredSortedQuestions()`, deliberately mirroring `filteredQuestions()` in `index.html` -- and every row (not just locked/uploaded ones cross-referenced through a contest) gets a **Preview…** button (`openPreview()`, a centered `.overlay`/`.drawer` modal showing `questionPreviewHtml()` plus status/author/date) and its own unconditional **Download image…** button. This was a deliberate widening from "only questions already in a contest paper can be recovered" to "every question in the backup can be recovered" -- a draft or not-yet-reviewed question is still better than no question if a paper has to go out during an outage. Chapter/skill/author filter options are derived from whatever's actually in `data.questions` (`distinctUnits()`/`distinctSkills()`/`distinctAuthors()`), not from the live app's hardcoded Beast Academy curriculum constant, which this file doesn't carry a copy of -- chapters show by raw unit code (e.g. "B3-C2") rather than "code — title".
- `backupFirestoreToDrive.gs` — a standalone Google Apps Script (paste into script.google.com, not part of the web app itself) that signs in as a dedicated read-only teacher account and writes an hourly JSON backup (same shape as `exportAllData()`/`backup-viewer.html` expects) to a Drive folder, so there's never more than ~1 hour of data to reconstruct if Firestore/the live site goes down, without anyone having to remember to click "Export all data" by hand. Talks to Firebase over plain REST (Identity Toolkit `accounts:signInWithPassword` for an ID token, then the Firestore REST API with that token as a Bearer credential) since Apps Script has no Firebase SDK -- this is the standard no-backend pattern for Apps Script + Firestore, and the signed-in account is bound by the exact same `firestore.rules` `isTeacher()`/role checks it would be through the real app. Full setup walkthrough is a comment block at the top of the file itself (Script Properties needed: `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `BACKUP_EMAIL`, `BACKUP_PASSWORD`, `DRIVE_FOLDER_ID`, optional `MAX_BACKUPS` default 72); run `testConnection()` once to verify credentials, then `installHourlyTrigger()` once to start it. `pruneOldBackups_()` keeps only the most recent `MAX_BACKUPS` files it created (matched by filename prefix) so the folder doesn't grow unbounded. If `questions`/`contests`/`assignments`/`curriculumExtra`'s shapes ever change in `index.html`, this script needs no changes itself (it just mirrors whatever fields exist in Firestore) -- but if a NEW top-level collection is ever added that should be backed up too, both this script and `exportAllData()` need the same new `firestoreListDocuments_()` call added.
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
