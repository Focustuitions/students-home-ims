# Assignment Portal Workflow Update

## Assignment Pending
- Pending work is grouped by the original assignment batch, so a class-wide or division assignment appears as one register row instead of one row per student.
- Selecting **View Students** expands the assignment and shows its student list, with per-student Mark Submitted actions retained.
- New batches receive an `assignment_group_id`; older records without that identifier are grouped using their common academic year, class, dates, type, subject, teacher, and work details.
- The expanded student list is scroll-contained to prevent large batches from stretching the page.

## Assignment Submission Workflow
1. Select **Imposition** or **Work**.
2. Select the specific pending assignment.
3. Enter one Admission Number and press Enter.
4. Continue with the next Admission Number. Students are validated against that assignment and duplicate scans are blocked.
5. Press **Finish & Mark Submitted** to confirm and submit all students in one transaction.
- Selected students move from Assignment Pending to Assignment History. Remaining students stay Pending.
- The existing Reverse action continues to restore an incorrectly submitted record to Pending.

## Compatibility
- An additive `assignment_group_id` column is created automatically on application startup for existing databases. No manual SQL migration is required.
- Existing student assignment records, status values, and history are preserved.
- The existing Late Arrival bulk submission workflow is unchanged.
