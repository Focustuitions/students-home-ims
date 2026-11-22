# Parent Portal — Assignment and Attendance Visibility

The authenticated Parent Portal and Student Performance Sheet now include work-completion and daily-attendance records for the signed-in student's own admission number and academic year.

## Parent Portal
- Assignment Details: assignment type/details, given date, due date, subject, teacher, submission status and submitted date.
- Late Arrival Additional Work: late date, due date, details and submission status.
- Attendance Record: recorded-day, present, absent and attendance-percentage summary, plus the latest 20 dated attendance entries.
- The existing Download Student Performance Sheet link opens the full report, including the complete attendance history.

## Student Performance Sheet
- Continues to show regular assignments and late-arrival additional work.
- Adds a complete attendance summary and dated Present/Absent history for the selected academic year.
- The same report data powers parent and administrator student performance sheets.

## Data and privacy
- Parent dashboard data is queried using the admission number from the authenticated parent session; no admission number is accepted from the browser for these records.
- Parent dashboard assignment queries are scoped to the student's academic year, with year-null legacy rows included for compatibility.
- Attendance is scoped to the student's admission number and academic year.
- Parent performance report derives both admission number and academic year from the authenticated student's record.
- No database schema changes or migrations are required.
