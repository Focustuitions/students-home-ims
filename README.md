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

## Features

### Students
- **Admit Student** — admission no., name, class (10/9/8), division (A–E, M), medium
  (English/Malayalam), school (AKM, IUHSS, PKMM, NSS, FEM, MALABAR, NAJATH, GRHSS, PMSA,
  or Others with a text field), parent details, place, total fees (dropdown of
  ₹15,900 / ₹13,300 / ₹10,800), and a discount that is automatically subtracted to
  give the net payable fee. Joining date defaults to today and can be changed.
- **Students list** — search by name/admission no./guardian/place, filter by class,
  division, medium, and fee-balance status. Click any row to open the full student
  file with an **Edit** option and the complete fee ledger.
- **Export Fee Pending** — downloads a CSV of every student with an outstanding
  balance, ready for follow-up calls or printing.

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
  student's file.

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
