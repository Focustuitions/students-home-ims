# Late Arrival Additional Work

Admin navigation includes **Late Arrival Work** to record additional work given to students who arrive late.

## Workflow

1. Enter the late-arrival date (defaults to today).
2. Paste Admission Numbers from any class or division, one per line or separated by spaces, commas, or semicolons.
3. Preview the matched student list; class and division are identified automatically for each student.
4. Confirm the automatically calculated due date (one calendar day after the late-arrival date).
5. Finish to save the batch.

Numeric Admission Number prefixes are resolved across all active students in the selected academic year. Class 10 requires at least three digits; Classes 8 and 9 require at least four digits. If a prefix matches more than one student across classes or divisions, the preview asks for the full Admission Number. Repeated inputs, already-recorded students, withdrawn students, and missing students are flagged. A maximum of 500 students can be processed in one batch. Class and division filters remain available in the register and exports, but are not required when recording a batch.

## Submission tracking

The portal shows Pending, Overdue, and Submitted work. Admin can mark a record Submitted, return it to Pending, or delete it. Submission date and submitter are stored. Deleting a record also removes it from the student's performance report.

## Student Performance Report mapping

The common Student Performance Report API returns both:

- Regular Impositions & Assignments (`student_assignments`): type, given date, due date, details, subject, teacher, submission status and submitted date.
- Late Arrival Additional Work (`late_arrival_works`): late date, due date, work details, submission status and submitted date.

Both the Admin Student Performance Report and authenticated Parent Performance Sheet render these sections. Pending items appear in the report's Needs Attention summary.

## Database

`late_arrival_works` and its indexes are created automatically at startup. No separate database file or manual migration is required. Keep the existing `DB_PATH` pointing to the existing persistent SQLite database. Back up the database before deployment.
