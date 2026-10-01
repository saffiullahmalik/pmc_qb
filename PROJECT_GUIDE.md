# Question Bank by SundarSTEM — Project Guide

This is the plain-language guide to how the whole portal works — written for Saffi, teachers, and admins, not for an AI or a developer (that's what `CLAUDE.md` is for). If you want to know "what does this button do" or "why does the app behave this way," this is the file to read.

---

## What this is

Sundar STEM School runs the **Pakistan Math Contest (PMC)** — a talent-identification exam for ages 10–13, split into four categories:

| Contest | Age | Curriculum anchor |
|---|---|---|
| PMC-4 | 10 | Beast Academy Book 3 |
| PMC-5 | 11 | Beast Academy Book 4 |
| PMC-6 / PMC-7 | 12 / 13 | Beast Academy Book 5 |

This portal is where a team of teachers collaboratively **write, tag, peer-review, lock, assemble into papers, and upload** every question that ends up in a live PMC exam. It lives at `https://saffiullahmalik.github.io/pmc_qb/`, runs entirely in the browser, and is free to operate (Firebase's free "Spark" plan) — there's no server to maintain.

---

## Who can do what

Every person who can sign in has one of four roles, set by an admin:

- **Teacher** — can write, edit, and comment on any question; can rate and like questions; can be assigned chapters or peer reviews.
- **QB Lead** — everything a teacher can, plus can lock a question (once peer review agrees with it) and unlock one back to "In Review."
- **Admin** — everything above, plus: create/remove teacher accounts, delete questions, manage workload assignments, set daily limits, add curriculum, and see the full activity log.
- **External Reviewer** — a separate, read-and-comment-only account for an outside spot-checker. They get one simplified screen (a "Pick a random question" button) instead of the normal toolkit, can open **any** question including already-locked ones, and can leave a comment — but can't write, edit, or change a question's status. Their comments carry a purple "External Reviewer" tag so they stand out in the thread, and if they comment on a locked question, the admin viewing it sees an explicit prompt to unlock it and apply the fix.

There's no public sign-up — an admin creates every login from **Admin → Manage teachers**.

---

## The life of a question

1. **Draft** — a teacher writes it: English + Urdu prompt, a figure or a shared equation if needed, 2–8 options, difficulty, chapter, skill(s) tested, and a required solution.
2. **In Review** — the moment a question is moved here, the portal automatically assigns it to a *different* teacher as a reviewer — see "Peer review" below. The author can keep editing while it's in this state; other teachers can comment at any point regardless of status.
3. **Peer review happens** — the assigned reviewer solves the question independently (without seeing the marked answer), submits their own answer, their working, and how long it took them.
   - If their answer **matches** the marked one → the review **agrees**, and the question becomes lockable.
   - If it **doesn't match** → the review **disagrees**, a comment explaining the mismatch is posted automatically, and the question **cannot be locked** until the author fixes it and a re-review agrees. Saving an edit after a disagreement automatically sends it back to the *same* reviewer.
4. **Locked** — a QB Lead (or admin) locks it once review has agreed. A locked question's content can't be edited by a QB Lead anymore — only an admin can, or a QB Lead can unlock it (set it back to "In Review") first.
5. **Used in a contest** — an admin assembles locked questions into a paper (Contests tab), tagged with its category/day/slot; the question itself then shows a "Used in: [paper name]" tag.
6. **Uploaded** — each question is downloaded as an image and uploaded to the exam delivery tool one by one, tracked per question (in which contest/day/slot) so nothing gets uploaded twice or missed.
7. **Uploaded** (status) — after a test cycle, admins can also record post-test statistics (p-value, discrimination index) against the question to flag ones worth revising for next time.

---

## Daily limits (quality control)

An admin sets three numbers (**Admin → Daily limits**):

- **Daily creation target** (default 15) — hit this many days in a row and you build a streak.
- **Daily creation cap** (default 20) — the hard stop; you can't create a 21st question today no matter what. The 15–20 range is "bonus" work beyond the daily target.
- **Daily review cap** (default 20) — the same idea, for how many peer reviews you can submit in a day.

These exist so a rush to hit a quota never comes at the cost of quality — the cap is a ceiling, not a target.

---

## Difficulty balance (per assigned chapter)

Each assigned chapter's target splits evenly across the three difficulties — a 15-question target means 5 Medium, 5 Hard, 5 Very Hard (any target not divisible by 3 rounds up on Medium and Hard first). The editor shows where you stand against that split live as you pick a chapter and difficulty, and **won't let you save** a question in a difficulty that's already full for that chapter — pick a different difficulty instead. This only applies to chapters actually assigned to you; self-initiated questions outside an assignment aren't balance-checked.

---

## Peer review, in detail

- **Assignment is random but balanced** — when a question goes "In Review," the portal looks at every other teacher's currently-pending review queue and picks randomly among whoever has the fewest pending reviews right now. No one teacher gets buried while another coasts.
- **The reviewer solves it blind** — the review screen hides which option is marked correct. They pick their own answer, write their solution, and log their time, same as if they were a student doing the real exam.
- **A disagreement is a real signal**, not just an opinion — it usually means the question is ambiguous, has a typo, or the wrong option was marked. That's exactly what this step exists to catch before a question reaches a live contest.
- Your "to review" queue shows up on the Question Bank tab's dashboard and the Activity feed, with a **Solve now** button.
- Separately, an **External Reviewer** account (see "Who can do what") can be asked to spot-check random questions — including already-locked ones — any time, independent of this balanced rotation.

---

## Gamification

A thin strip at the top of every tab shows your current streak, today's progress toward the daily target, this week's total, and how many reviews you still owe. The Question Bank tab's right-hand panel goes further:

- **Your assignments** — one thin bar per PMC level showing how much of your assigned quota is locked; click a level to expand it into its individual chapters.
- **Your questions** — a donut of your own draft/in-review/locked breakdown.
- **Last 7 days** — a bar per day of how many questions you created.
- **Team** — every active teacher as a bar labeled by initials (e.g. "Imdad Hussain" → "IH"), sorted by total output (creating *and* reviewing both count), with your own bar bolded so you can find yourself at a glance — hover any bar for the full name.
- **Reviews** — your pending review count with a **Solve now** button, plus a donut of how often your completed reviews agreed with the marked answer.

---

## Every tab, in one line each

- **Question Bank** — the full list of questions, with filters, sort, and your personal dashboard at the top.
- **Activity** — the 30 most recently posted questions across the whole team, so everyone knows what's new and needs a comment.
- **Contests** — assemble locked questions into a paper (tagged by category/day/slot), print a bilingual exam + answer key + solution manual.
- **Upload** — pick a paper by category → day → slot, download each question as an image, mark it uploaded, with a record of who uploaded what and when.
- **Assignment** — a drag-and-drop board for admins to hand out chapters (or custom tracks like IQ/Logic reasoning — if none exists yet, a link right there points to where to add one) to teachers, plus a dashboard of who's assigned what and a team comparison chart.
- **Curriculum Map** — the full Beast Academy chapter reference, plus any custom books/chapters an admin has added (this is also how a cross-cutting track like "IQ & Logic Reasoning" gets added — it doesn't have to belong to just one PMC level).
- **SOP** — the official school procedure document, for reference inside the app.
- **Admin & Analytics** — teacher accounts, daily limits, curriculum additions, backups, post-test statistics, and the activity log (admin-only).

---

## Admin controls, summarized

- **Who's assigned what** → Assignment tab's Kanban board (drag a chapter into a teacher's column, or use the "+ Add a chapter" dropdown; remove with the ✕ on a card).
- **How much can be created/reviewed per day** → Admin → Daily limits.
- **Who has access at all** → Admin → Manage teachers (create, promote/demote, remove) — including setting up an External Reviewer account.
- **A full audit trail** → Admin → Activity Log (who did what, when — admin-only).
- **A safety net** → Admin → Export all data as JSON, openable offline with `backup-viewer.html` if the live site or Firestore is ever unreachable.

---

## If something looks wrong

This whole app is one file, `index.html`, with no build step — anyone with repo access can open it directly and read the relevant function. `CLAUDE.md` is the technical map of the codebase for picking up development again (with an AI assistant or without one); this file is the "how does the workflow actually work" companion to it.
