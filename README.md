# Students' Home — Institution Management System

A self-contained Node.js web app for managing student admissions, fee collection,
teachers, and timetables — styled with the Students' Home brand (logo, colours,
and Nubo the mascot).

## What's inside

- **Backend:** Node.js + Express, REST API
- **Database:** SQLite (via `better-sqlite3`) — a single file, no separate DB server to install
- **Frontend:** Plain HTML/CSS/JS single-page app (no build step required)

## Requirements

- Node.js 18 or newer (download from https://nodejs.org if you don't have it)

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

The database file is created automatically on first run at `db/institution.db`.
To run on a different port: `PORT=4000 npm start`.

### First-time login

The very first time you open the app, you'll be asked to create the one
administrator account (username + password, at least 6 characters) instead
of seeing a login form. From then on, everyone signs in with that account.
You can change the password later from the sidebar (**Change Password**),
and sign out with **Log Out**. There's no separate "forgot password" flow —
if you lose the password, you'll need to reset it directly in the database
(ask if you'd like help with that) or delete `db/institution.db` to start
over (this erases all data, so only do this on a fresh install).

## Features

### Administrator Login
- The whole app sits behind a single administrator login — every API route
  requires a signed-in session except the login/setup screens themselves.
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
  Receipt No. is auto-filled with one more than the highest numeric receipt on
  file (so 825 → 826) but stays fully editable for the rare correction.
  Non-numeric receipts (like the "OB-" opening-balance entries an import
  creates) are ignored when suggesting the next number.
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
  strongest and weakest subjects, a trend indicator (Improving / Steady /
  Declining, based on recent tests vs. earlier ones), a subject-by-subject
  strength chart, a score-over-time chart compared against their class
  average, a short auto-generated summary in plain language, and the full
  test-by-test history with how each score compared to the class. If the
  student has any Hot Seat records for the year, a **Classroom Engagement**
  section is added automatically — session count, predominant rating, a
  checklist completion score, a missing-materials alert count, the rating
  distribution, per-item checklist bars, and the most recent remarks and
  parent feedback. It opens in a new tab and prints cleanly on A4 — handy
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
├── server.js              Express app entry point
├── db/
│   └── database.js        SQLite schema & connection
├── routes/
│   ├── students.js
│   ├── payments.js
│   ├── teachers.js
│   ├── timetable.js
│   └── classes.js
└── public/                 Frontend (served statically)
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## Notes

- This is a single-tenant admin tool with no login/authentication built in — it's
  intended to run on a local machine or a private network. If you plan to expose
  it on the internet, add an authentication layer first.
- All data lives in `db/institution.db`. Back that file up regularly; copying it
  elsewhere is a complete backup.
