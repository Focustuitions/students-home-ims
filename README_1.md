# Students' Home — Institution Management System

A self-contained Node.js web app for managing student admissions, fee collection,
teachers, and timetables — styled with the Students' Home brand (logo, colours,
and Nubo the mascot).

## What's inside

- **Backend:** Node.js + Express, REST API
- **Database:** SQLite (via `better-sqlite3`) — a single file, no separate DB server to install
- **Frontend:** Plain HTML/CSS/JS single-page app (no build step required)

## Requirements

- Node.js 22 or newer (download from https://nodejs.org if you don't have it)

## Setup

1. Unzip this project and open a terminal in the project folder.
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. Open your browser to **http://localhost:3000**

For local development without `DB_PATH`, the database file is created at `db/institution.db`.
For Hostinger production, set `NODE_ENV=production` and `DB_PATH` to the existing SQLite file in a private persistent folder outside `hbuilds` and `public_html`; the app intentionally refuses to start with a missing production database. See `HOSTINGER_DEPLOYMENT_NOTES.md`.
To run on a different port: `PORT=4000 npm start`.

### First-time login

The first time an administrator opens the app, they create the administrator
account (username + password, at least 6 characters). Administrators can change
the password from the sidebar and sign out with **Log Out**. There is no
self-service administrator password recovery; keep the admin credentials secure
and retain backups. Do not delete the production database to recover a password,
as that would erase the institution's data.

## Features

### Administrator Login
- The Institution Manager sits behind administrator login. The separate Parent Portal uses student-specific sessions and can only access the signed-in student's records.
- Sessions are cookie-based (HttpOnly, 30-day expiry) and stored in the
  database, so a server restart doesn't force everyone to sign in again.
- Passwords are hashed with bcrypt before being stored — the plain password
  is never saved anywhere.
- **Change Password** and **Log Out** are both available from the sidebar
  once signed in.

### Dashboard
- At-a-glance totals for the active academic year: total students, fees
  collected, fees pending, and faculty on roll.
- **Fee Balance by Class** and **Recent Admissions** tables for a quick read
  on where things stand.
- **Recent Payments** — the last several payments recorded, each with a
  one-click **Receipt** link, so you can see who paid recently without
  opening Payment History.

### Academic Years
- Every year of admissions, classes, and timetable entries is kept separate.
  The **Academic Year** switcher in the sidebar shows the active year and lets
  you jump between years — switching updates the whole app (students,
  classes, teachers' worklog hours, timetable, dashboard) to that year.
- Click **+** next to the switcher to add a new year (e.g. "2027-28"); it
  becomes the active year immediately, ready for fresh admissions.
- A fresh install auto-creates the current year for you (e.g. installing in
  August 2026 creates "2026-27"), and any data from before this feature
  existed is kept exactly where it was.
- The **Teachers** roster is shared across years (the same teacher can teach
  in multiple years), but their hours-logged and earnings shown are always
  for the year currently selected.
- Admission numbers must stay unique across the whole system, not just
  within a year — which matches how year-coded admission numbers like
  `8028EKL26` already work.

### Students
- **Admit Student** — admission no., name, class (10/9/8), division (A–E, M), medium
  (English/Malayalam), school (AKM, IUHSS, PKMM, NSS, FEM, MALABAR, NAJATH, GRHSS, PMSA,
  or Others with a text field), parent details, place, total fees (dropdown of
  ₹15,900 / ₹13,300 / ₹10,800), and a discount that is automatically subtracted to
  give the net payable fee. Joining date defaults to today and can be changed.
  New admissions are filed under whichever academic year is currently active.
- **Students list** — search by name/admission no./guardian/place, filter by class,
  division, medium, and fee-balance status. Click any row to open the full student
  file with an **Edit** option and the complete fee ledger.
- **Delete Student** — on a student's file page, **Delete Student** permanently
  removes them and their payment history after a confirmation prompt. This
  cannot be undone.
- **Export Fee Pending** — downloads a formatted Excel workbook of every
  student in the active year with an outstanding balance, ready for
  follow-up calls or printing.
- **Export Student Details** — downloads a complete Excel workbook covering
  every student in the active year: a **Students** sheet with every profile
  field (contact details, fees, discount, balance, status, remarks), a
  **Payment History** sheet with every receipt, a **Weekly Test Summary**
  sheet (tests taken, average %), and a **Hot Seat Summary** sheet (session
  count, predominant rating, missing-materials alerts) — everything the
  software holds about students, in one file.
- The students list shows **50 students per page**, with page controls
  underneath the table.

### Fee Payment
- Type an **Admission No.** and the student's name, class, net fee, amount already
  paid, and balance due fill in automatically.
- Enter receipt no. and amount; payment date defaults to today and is editable.
  Receipt No. is initially auto-filled with one more than the highest numeric
  receipt on file (so 825 → 826). After that, the last numeric receipt number
  saved (or set while editing a receipt) becomes the basis for the next
  suggestion. Manually changing the number therefore changes the next
  auto-filled number too. Non-numeric receipts (like "OB-" opening-balance
  entries an import creates) are ignored when suggesting the next number.
- **Payment History** lists every payment across all students, searchable by
  admission no., student name, or receipt number, and each row links back to the
  student's file. Shows **50 payments per page**, with page controls underneath.
- **Edit a receipt** — every row in Payment History and on a student's Fee
  Ledger has an **Edit** link. It opens the same form with the student
  locked in (so a receipt can't accidentally be reassigned) but Receipt No.,
  Amount, and Payment Date are all editable — handy for correcting a typo or
  a wrong amount after the fact. Saving updates the student's fee balance
  immediately.

### Classes
- Add and remove class/division/medium combinations used across the system.
  Add these first — the Timetable grid and entry form both pull their class
  columns from this list.

### Teachers
- Add a teacher with name, classes handled, subject, hourly rate, and phone.
- Each teacher's row shows total hours logged and total amount earned, computed
  automatically from the timetable (see below).

### Timetable
- **Weekly Grid** — a period-by-period view just like a school timetable: pick a
  date (with prev/next-day arrows), and see every class as a column and every
  period as a row, with each cell showing the subject and the teacher's
  initials in colour. Click a filled cell to remove that class. Empty dates or
  classes show a friendly prompt with Nubo rather than a blank page.
- Classes are scheduled hour-by-hour in the entry form below the grid: pick a
  date, start time, end time, class & division (from the Classes list),
  subject, and teacher.
- You can add a brand-new teacher directly from the timetable form — choose
  "+ Add new teacher…" in the teacher dropdown.
- Hours are calculated automatically from the start/end time and are logged
  straight to that teacher's worklog — no manual entry required. The Teachers
  page reflects updated hours and earnings immediately.
- A plain list view sits underneath the grid for quick scanning/removal across
  any date.

### Weekly Tests
- Marks are uploaded from an Excel sheet with **Admission No, Name, Exam,
  Mark** columns — the same format the institution's own exports already
  use. "Mark" can be a number or "AB" for absent.
- Since that sheet doesn't carry a date, the **Test Date** (and Max Marks,
  default 20) are set once on the Import Data page right before uploading.
- "Exam" names like `Class 10 - Biology - Chapter 1` are automatically split
  into class/subject/topic for reporting; anything that doesn't match that
  pattern is kept as one label.
- Re-uploading the same exam name on the same test date updates those marks
  instead of creating a duplicate test — handy for correcting an entry.
- The **Weekly Tests** page lists every imported test for the active academic
  year with at-a-glance stats (present/absent, average, pass rate) and a
  **Report** link for each.
- **Weekly Test Report** — a printable, professional report built to
  highlight academic performance: summary stats (average, highest, pass
  rate), a grade-distribution breakdown (Excellent/Good/Average/Below
  Average/Needs Improvement), a Top Performers list, a "Needs Attention" list
  of students below the pass mark, and the full ranked mark list with
  pass/fail status. It opens in a new tab, prints cleanly on A4, and has a
  one-click **Export Excel** button for a formatted two-sheet workbook
  (summary + full marks).
- Every student's file page shows their own **Weekly Test Performance**
  history across all tests they've taken, each linking to that test's report.
- **Student Performance Report** — click **Performance Report** on a
  student's file for an individual report that pulls together every weekly
  test they've taken in the active academic year: overall average, their
  strongest and weakest subjects, a **class rank** (e.g. "12 of 42"), a
  trend indicator (Improving / Steady / Declining, based on recent tests
  vs. earlier ones, labelled with how many tests it's based on), a
  subject-by-subject strength chart, a score-over-time chart compared
  against their class average, a short auto-generated summary in plain
  language, and the full test-by-test history with how each score compared
  to the class. A **"Needs attention" banner** appears near the top
  whenever a subject is below the pass mark, tests have been missed, or
  Hot Seat has flagged missing materials — so the most important thing to
  know doesn't get buried under everything else. If the student sat any
  **Term Exams** this academic year, a **Term Examinations** section is
  added automatically — every exam they took, with a subject-wise
  breakdown, their overall percentage and class rank, and how that compares
  to their class average. When a student has both weekly test and term
  exam results, an **Analysis: Weekly Tests vs. Term Exams** section
  compares the two — overall averages side by side, a plain-language
  verdict (Consistent / Stronger in Weekly Tests / Stronger in Term Exams)
  with a short written explanation, and a subject-by-subject table showing
  where the two formats agree or diverge. If the student has any Hot Seat
  records for the year, a **Classroom Engagement** section is added
  automatically — session count, predominant rating, a checklist
  completion score, a missing-materials alert count, the rating
  distribution, per-item checklist bars, and the most recent remarks and
  parent feedback. The report closes with a blank **Teacher's Remarks** box
  and signature lines for the date, class teacher, and parent/guardian, so
  it's ready to print and hand out as-is. It opens in a new tab and prints
  cleanly on A4 — handy
  for parent meetings or progress reviews.
- **Top Performing Students** — a leaderboard on the Weekly Tests page
  ranking students by their average score across every weekly test they've
  taken this academic year, grouped into columns by class (10, 9, 8).
  Toggle between Top 10 and Top 25 per class, and click any student to open
  their file. A **Printable Report** link opens a clean A4 leaderboard
  (medal-style ranking for the top 3 in each class) suitable for posting or
  sharing at parent meetings.
- **Most Improved Students** — right below the leaderboard, this compares
  each student's most recent weekly test scores against their own earlier
  scores this academic year (not against classmates), so it surfaces genuine
  upward trends rather than just who's already strongest. A student needs at
  least 3 weekly tests on file to qualify, and only shows up if the
  improvement is meaningful (a noticeable jump, not test-to-test noise).
  Same Top 10 / Top 25 toggle, per-class columns, and a **Printable Report**
  showing each student's earlier-average → recent-average and how much
  they've gained.

### Term Exams
- For multi-subject term/annual examinations, uploaded from a marklist
  workbook — one sheet per class/division (e.g. "10 A", "10 B", "10 C"),
  each with a header row of **Adm No, Name, Class**, then one column per
  subject. Marks are numbers, or "AB" for absent; a blank cell means that
  subject doesn't apply to that student (not zero).
- Since the sheet doesn't carry a date, the **Exam Name** (default "Term
  Examination") and **Exam Date** are set once on the Import Data page
  right before uploading.
- **Max marks per subject aren't in the sheet either** — they're detected
  automatically from the highest score seen for that subject, rounded up to
  a standard total (40, 50, 80, or 100). The result after uploading shows
  exactly what was detected for each subject, so it's easy to check —
  re-uploading with a correction is safe, since the same exam name, class,
  and date updates existing marks rather than duplicating them.
- The **Term Exams** page lists every imported exam for the active academic
  year with quick stats (subjects, students, average/highest/lowest) and a
  **Report** link for each.
- **Term Exam Report** — a printable A4-landscape report per class: subject-
  wise class averages, Top Performers and Needs Attention lists, and the
  full marklist with every subject, total, percentage, and pass/fail status.
  Has the same one-click **Export Excel** option as the other reports.
- Every student's **Performance Report** now includes their term exam
  results alongside weekly tests and Hot Seat — see below.

### Hot Seat
- A quick per-session classroom observation log — how a student did when put
  on the spot in class, separate from formal weekly test marks.
- **Add a record** by typing an Admission No. (name, class & division, and
  school auto-fill, same as Fee Payment), then set the date, subject,
  teacher, and an overall performance rating (Excellent / Very Good / Good /
  Average / Poor).
- **Checklist** — Notes Completed, Notebook Neat, Questions Answered, Good
  Attention Span, plus two alert flags: No Notebook and No Text Book.
- **Remarks** for the teacher's own notes, and **Parent Feedback** for
  anything to flag home — both optional free text.
- The records table below the form is searchable by admission no., name, or
  subject, and every record can be edited or removed.
- Every student's file page shows their own **Hot Seat History**.
- This feeds directly into the **Student Performance Report** — see below.

### Import Data
- **Import Students** — upload an Excel file to add or update students in bulk.
  Matched by Admission No, so re-uploading the same file safely updates records
  instead of duplicating them. Accepts either the app's own template or an
  export from another system (columns like "Mother Number" / "Father Number" /
  "Phone" / "Remark" are recognised automatically). Medium is guessed from the
  Admission No suffix (EKL → English, MKL → Malayalam) if not given explicitly.
- **Import Teachers** — upload Name, Classes Handled, Subject, Hour Rate, and
  Phone in bulk. Matched by name (case-insensitive), so re-uploading updates
  rather than duplicates.
- **Import Teacher Timetable** — upload a "weekly grid" Excel file shaped like
  a school timetable: a header row (`Date | Day | TIME | 10A | 10 B | ...`)
  immediately followed by a data row, repeated down the sheet (and across
  sheets) for every period. Each class cell holds the subject plus the
  teacher's initials, e.g. `Maths SF`. The importer matches those initials
  against your Teachers list — add teachers first. Anything it can't resolve
  (no initials, unknown initials, or initials shared by two teachers) is
  listed in the results so you can fix and re-upload.
- **Import Fee Balances** — upload Adm No, Total Fee, Discount, and Paid per
  student. This sets each student's fee structure and tops up their recorded
  payments with one "opening balance" entry per student (receipt
  `OB-<admission no>`) to match the sheet's Paid figure — your existing
  individual payment records are never touched. Safe to re-run: it only
  adjusts the shortfall, so running it twice with the same numbers changes
  nothing the second time.
- Every importer reports what was **added**, **updated**, and what **needs
  attention** with the exact row and reason, right after upload.
- Sample templates for all four are one click away on the Import Data page.

## Fee receipts

Every recorded payment can be printed as a clean, professional A5 receipt:
- Right after recording a payment on the **Fee Payment** page, a "Print
  Receipt" button appears next to the confirmation.
- Every row in **Payment History** and on a student's **fee ledger** has a
  "Receipt" link.
- Receipts open in a new tab at `/receipt.html?id=<payment id>` with a "Print
  Receipt" button; the page is styled for A5 paper (`@page { size: A5; }`) so
  browser printing or "Save as PDF" produces a correctly sized receipt with
  Admission No, Student Name, Class & Division, Amount Paid, Balance Due, and
  the payment date — no manual layout work needed.

## Fee-pending export

The **Export Fee Pending (Excel)** button on the Students page downloads a
formatted `.xlsx` workbook of every student with an outstanding balance —
Adm No, Name, Class, Division, School, parent phone numbers, Total Fee,
Discount, Paid, and Balance — sorted by class and division, ready to open in
Excel or share directly.

## Branding

- The Students' Home logo appears in the sidebar and as the browser tab icon.
- Nubo, the book-sprite mascot, appears in the sidebar, the dashboard welcome
  banner, and empty states throughout the app.
- The colour palette (teal, orange, pink, blue, yellow, navy) is pulled
  directly from the official brand assets and defined as CSS variables at the
  top of `public/css/style.css` — change them there to retint the whole app.

## Project structure

```
ims/
├── server.js                  Express app entry point
├── db/
│   ├── database.js            SQLite schema & connection
│   ├── auth.js                Administrator sessions
│   └── parentAuth.js          Parent sessions
├── routes/
│   ├── parents.js             Parent login, password, and student-only API
│   ├── students.js
│   ├── payments.js
│   └── other admin APIs…
└── public/
    ├── index.html             Administrator dashboard
    ├── login.html             Administrator login
    ├── parent-login.html      Parent sign-in
    ├── parent.html            Parent home dashboard
    ├── parent-weekly-tests.html Weekly test records
    ├── parent-term-exams.html Term exam records
    ├── parent-progress-report.html Printable progress report
    ├── css/style.css
    └── js/app.js
```

## Production security and backups

- Use HTTPS on the public website. Keep `DB_PATH` outside the public web root and replaceable deployment folders. Never include the live database in a deployment ZIP or public repository.
- Parent users initially sign in with Admission Number and the mother's registered mobile number, then must choose a private password. If a parent forgets it, an administrator can use **Reset Parent Login** on the student detail page.
- Back up the persistent database regularly, and keep at least one backup offline. All student, payment, and exam data is stored there; treat it as confidential.

### Parent Portal
- Parents sign in at `/parent-login.html` with the student's Admission Number and the mother's mobile number currently registered on that student record.
- On the first successful sign-in, the portal asks the parent to create a private password before displaying student information. Passwords are stored as bcrypt hashes in `parent_accounts`.
- The portal shows only the signed-in student's profile, fee-payment history and balance, weekly test marks, term-exam marks, and Hot Seat teacher observations. Parent sessions use a separate HttpOnly cookie and do not grant access to administrator APIs.
- Parent login attempts are rate-limited. Parent sessions expire after seven days.
- To recover a forgotten parent password, an administrator can open that student's record and click **Reset Parent Login**. This resets the initial password to the mother's currently registered mobile number, invalidates existing parent sessions, and requires a password change at the next sign-in. If the mother's number is missing or outdated, update the student record first.
- The parent portal is available at `/parent-login.html`; the administrator sign-in page now links to it.

### Parent Portal — Separate Academic Pages and Progress Report
- The Parent Portal home page shows **Weekly Tests** and **Term Exam Reports** as separate navigation cards with result counts; the marks tables are not displayed on the home page.
- **Weekly Tests** opens `/parent-weekly-tests.html` and **Term Exam Reports** opens `/parent-term-exams.html`. Each page has its own results table, student identification, home navigation, and logout control.
- Parents can still open **Download Progress Report** from the home page. The report includes the student's profile, weekly-test marks, term-exam marks, and teacher observations in separate sections.
- The report can be saved as a PDF using the browser's **Download / Save as PDF** print action. All three academic pages read data only from the authenticated parent dashboard API; they do not accept an admission number in the URL, so records remain limited to the signed-in student's account.
## Latest dashboard update

The admin dashboard now includes a **Top 20 Students with Highest Pending Fee** table. It uses the existing student balance calculation, follows the selected academic year, excludes fully paid students, and links each row to the student profile. No database migration is needed. See `ADMIN_TOP20_PENDING_FEES.md`.

### Student withdrawal / archive

Admin can move a student from their profile into the **Left / Withdrawn** register. This is a reversible status change, not deletion: student details, payment receipts, and academic marks remain preserved. Withdrawn students are excluded from active student totals and all active fee-pending lists/exports. Their remaining balance is retained in the archive as historical information. The archive includes search and a Restore action for students who rejoin. Database columns and status-history records are created automatically at startup.

## Update Student Divisions by Excel

Use **Import Data → Update Student Divisions** to move existing students between divisions. Download the sample template, fill `Admission No` and `New Division`, then upload it. `Class (Optional)` can be included as a cross-check. The import updates only the division, skips withdrawn students and duplicate admission numbers, and reports unchanged or invalid rows. See `DIVISION_UPDATE_IMPORT.md` for details.


## Fee Pending Slip Generation

The Admin navigation includes **Fee Pending Slips**. Select a class, enter a target amount per student, and choose a due date. The tool previews active students with unpaid balances in the selected class and prints individual reminders (four per A4 page (2 × 2)). The entered amount is a cumulative paid-fee target. Each slip requests `min(max(target − already paid, 0), actual outstanding balance)`. Students who have already reached the target are excluded, as are withdrawn students. This tool is a print-only workflow and does not alter payments or the database. See `FEE_PENDING_SLIPS.md` for details.

## Delete Receipt

Administrators can delete a payment receipt from the Student Profile fee ledger, Payment History, Dashboard recent payments, or Edit Fee Receipt screen. Deletion is permanent, removes that payment from the fee ledger, and recalculates paid and pending totals wherever they are displayed. The receipt-number sequence is not rolled back, avoiding accidental reuse of a deleted receipt number. Back up the database before deleting real payment records. See `DELETE_RECEIPT.md`.


## Quick Mark Entry (November 2026)

Admin can now enter marks one student at a time using date, class, subject, topic and maximum marks. Class 10 students can be found using the first three digits of the Admission Number. Saved entries are part of Weekly Tests and can be exported to Excel. See `MARK_ENTRY.md`.


## Mark Entry update (keyboard-driven)

The Mark Entry page now follows this flow: enter test date, class, subject, topic and maximum marks; select Start / Resume; type an Admission Number and press Enter; type the mark and press Enter. The saved mark clears the entry fields and focuses the Admission Number input for the next student. For Class 10, the first three digits can identify a student; if multiple records match, select the correct student from the list. The Finish button closes the entry session after confirmation. Saved marks are written directly to the existing Weekly Tests register and remain available for Excel export.

### Mark Entry resume support

Quick Mark Entry writes directly to Weekly Tests. Started tests remain marked **In Progress** if the portal/browser is closed, including sessions closed before the first mark is saved. Resume them from **Weekly Tests → Resume Entry**; the date, class, subject, topic, maximum marks and saved marks are restored. Press **Finish** to mark the session completed. Existing databases automatically receive the `weekly_tests.entry_status` column; existing test rows default to `completed`.

## Impositions & Other Assignments
See `ASSIGNMENTS.md` for the subject-specific teacher roster, quick-entry workflow, register filters and Excel export.
