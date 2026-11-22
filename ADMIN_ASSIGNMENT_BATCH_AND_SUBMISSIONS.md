# Admin Assignment Batch & Submission Tracking

## Admin batch workflow
- Given Date defaults to the local current date.
- Due Date defaults to one day after Given Date and can be edited.
- Select teacher, then a subject available for that teacher.
- Select active class and division.
- Paste Admission Numbers separated by newlines, spaces, commas, or semicolons.
- Preview resolves each entry and identifies ready, duplicate, unmatched, ambiguous, invalid, and wrong-division entries.
- Confirm creates the eligible assignments in a single transaction after revalidating all students and teacher/subject allocation.

## Submission tracking
- Each assignment has `submission_status` (`Pending` or `Submitted`), `due_date`, `submitted_date`, and `submitted_by`.
- Admin can mark a pending item submitted. The row immediately leaves Assignment Pending and appears in the separate Assignment History list with the status label Submitted.
- Assignment History provides a Reverse action for mistaken submissions. Reversing returns the record to Assignment Pending and clears the submitted date/by fields.
- Submitted records in the full Assignment Register show Submitted status and a separate Reverse action; they are not labelled Mark Pending.
- Assignment Pending excludes submitted and withdrawn-student records; Assignment History retains the currently submitted records.
- Due/overdue status is calculated from the due date.
- Excel export includes due date and submission details.

## Database update
The application adds the assignment due date and submission columns to `student_assignments` when it starts. Existing assignments receive a due date one day after their recorded given date and remain Pending until Admin marks them submitted. No student, fee, payment, or examination records are replaced.

## Teacher-created records
New impositions recorded through the Teacher Portal also receive a due date one day after the given date and start as Pending, so they appear in the Admin Pending Submissions list.
