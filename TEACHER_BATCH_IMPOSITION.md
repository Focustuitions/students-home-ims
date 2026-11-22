# Teacher Portal — Batch Imposition Entry

Teacher imposition entry now uses a batch workflow. Teachers select a given date (defaults to today's local date), an assigned class, an active division for that class, and an assigned subject. Work details remain optional.

Teachers can paste or type multiple Admission Numbers into the list (one per line, comma-separated or whitespace-separated). The portal previews every token before saving and classifies records as ready, already recorded, not found, wrong division, ambiguous, invalid, or repeated in the input list.

Only uniquely matched active students in the chosen class and division are eligible for confirmation. Class 10 accepts at least the first 3 digits; Classes 8 and 9 accept at least the first 4 digits. Full Admission Numbers are accepted. Prefixes matching multiple students must be replaced with full Admission Numbers.

On confirmation, the server revalidates the teacher's assigned class and subject, date, student status, class and division, and saves eligible records in one SQLite transaction. Existing duplicates are skipped. Preview does not write any records. The teacher's recent imposition list remains available below the entry form.

No database migration is required. The feature writes to the existing `student_assignments` table.

## Teacher-facing workflow
1. Given Date defaults to the current local date.
2. Teacher selects an assigned class, an active division belonging to that class, and an assigned subject.
3. Optional work details can be supplied and apply to all students in the batch.
4. Teacher enters/pastes multiple Admission Numbers (one per line, comma-separated or whitespace-separated).
5. Preview resolves each number and displays matched students plus any errors, duplicates, wrong-division matches or ambiguous prefixes.
6. Teacher confirms the preview. Only uniquely matched, active students in the selected class and division are saved. The server repeats permission and student checks and writes the batch in one transaction.

Admission-number rules: Class 10 accepts a minimum 3-digit numeric prefix; Classes 8 and 9 accept a minimum 4-digit numeric prefix. Full Admission Numbers are also accepted. If a prefix identifies more than one student in the chosen division, use the full Admission Number to disambiguate.
## Shared imposition submission tracking
- Impositions assigned by Admin are linked to the matching active Teacher Portal account when the teacher name resolves uniquely.
- Teacher Portal lists the impositions explicitly linked to that teacher account by Admin, along with older unlinked records that uniquely match the teacher name within the teacher's permitted classes and subjects.
- Teachers can mark an imposition Submitted or return it to Pending from the Teacher Portal. Admin can do the same in Impositions & Assignments.
- Both portals update the same `student_assignments` row, so status, submitted date and submitted-by value remain synchronized. No database migration is required.

## Imposition entry deletion
- Admins can delete individual imposition rows from Admin → Impositions & Assignments.
- Teachers can delete individual imposition rows assigned to their account from Teacher Portal → Assigned Impositions & Submissions. The teacher-side server route enforces the same account/class/subject ownership scope used for status updates.
- Deletion requires confirmation, including student, class, subject, date and current submission status. It permanently removes that shared `student_assignments` row from both portals. No database migration is required.
