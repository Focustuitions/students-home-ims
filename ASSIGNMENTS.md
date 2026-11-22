# Impositions & Other Assignments

Admin-only feature for recording impositions and other assignments against individual students.

## Quick-entry sequence
1. Enter the full Admission Number or at least its first three characters and press Enter.
2. Select the student if more than one record matches.
3. Choose the subject.
4. Choose the teacher for that subject.
5. Confirm or change the given date and press Enter (or click Save & Next Student).
6. The record is saved immediately and the Admission Number field is ready for the next student.

Work Type can be set to Imposition or Other Assignment. An optional task detail can be recorded.

## Default subject-teacher roster
- English: SN, NF, MA
- Hindi: KR, AR
- History: UN, MN, SH
- Geography: SQ
- Physics: RM, UK
- Chemistry: FZ, HK, MN
- Biology: SR, SH PKD, SH KTR
- Mathematics: SF, SR

Use **+ Add** beside Teacher to add another teacher to the selected subject. This roster is separate from teacher payroll/timetable profiles; it stores the initials/names used for assignment attribution.

## Register and export
The Assignment Register can be filtered by date, work type, subject and student/admission number. Export Excel downloads the records matching the current filters. An accidental record can be deleted from the register with confirmation.

## Database
On startup, the app creates `assignment_teachers` and `student_assignments` if they do not exist and seeds the default teacher roster with `INSERT OR IGNORE`. No existing student, fee, weekly-test or examination records are modified. Keep the existing `DB_PATH` unchanged.

## Admin batch creation and submission tracking

The Admin Assignment Portal now supports batch creation by given date, teacher, subject, class, division, Admission Number list, and due date. The due date defaults to one day after the given date and can be changed before preview. Preview identifies ready, duplicate, ambiguous, wrong-division, invalid, and not-found entries; only the revalidated ready entries are inserted when confirmed.

<<<<<<< HEAD
The Assignment Portal includes separate Assignment Pending and Assignment History lists. Marking an assignment Submitted removes it from Assignment Pending and moves it to Assignment History, where it is labelled Submitted. A separate Reverse action returns an incorrectly marked submission to Pending. The full register and Excel export include due date, submission status, and submission date. New Teacher Portal impositions also default to a due date one day after the given date and start as Pending.

## Entire-class assignment mode
The batch form can target either one division or the entire class across all divisions. In entire-class mode, a division and manual Admission Number list are not required; the app previews every active student in the selected class and academic year before saving. The API accepts `target_scope: "entire_class"` or the explicit `entire_class: true` checkbox flag. This dual-field handling keeps the workflow compatible with clients that submit the checkbox state separately.

If the browser has cached an older form script, the app.js URL version changes with this fix so the updated form logic is loaded.
=======
The Assignment Portal includes a Pending Submissions list. Administrators can mark each assignment Submitted (with submission date) or return it to Pending. The register and Excel export include due date, submission status, and submission date. New Teacher Portal impositions also default to a due date one day after the given date and start as Pending.
>>>>>>> 37296737b8e89abdb71d90327451e1ca2d723b4d
