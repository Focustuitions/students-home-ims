# Attendance — Absent Report Upload

## Workflow

1. Select the required academic year in the Admin Portal.
2. Open **Attendance** from the sidebar and upload the attendance-system absent report (`.xlsx` or `.xls`).
3. Preview the detected attendance dates, active-student count, matched absentees and students who will be marked Present.
4. Resolve all blocking issues (unmatched Admission Numbers, duplicate absent rows, inactive/wrong-year students, or class/division mismatches).
5. Confirm **Save Attendance**. For every date represented by absent rows, every active student in the selected academic year is recorded: report absentees as `Absent`, all other active students as `Present`.

## Supported report layout

The parser is mapped to the supplied report format:

- Department blocks such as `Department: 10 E 11` and `Department: 9 B 12`.
- Repeated table headings containing `Employee ID`, `First Name`, `Date`, `Absence`, and/or `Status`.
- `Employee ID` is matched to the website's `students.admission_no`.
- `First Name` is used as a name cross-check; Admission Number remains the matching key.
- Department class and division are checked against the student's current website record.
- The row date is stored as `YYYY-MM-DD`.

## Saving and corrections

- A preview does not change the database.
- The server re-parses and re-validates the uploaded file immediately before saving.
- Attendance is saved in one SQLite transaction.
- Re-uploading the same date updates the existing record for each student; the latest upload replaces any previous status for that date and academic year.
- The attendance register provides class/division summaries, student details and Excel export.
- The `attendance_records` table and indexes are created automatically at application startup; no manual SQL migration is needed.
