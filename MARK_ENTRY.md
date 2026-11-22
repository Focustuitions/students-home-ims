# Mark Entry – keyboard workflow and Weekly Tests integration

The Admin **Mark Entry** page is a quick-entry interface for the existing Weekly Tests register. It does not keep a separate mark-entry dataset or require a database migration.

## Workflow

1. Enter Test Date, Class, Subject, Topic and Maximum Marks.
2. Select **Start / Resume Mark Entry**. Existing marks for the matching Weekly Test are loaded.
3. Type an Admission Number and press **Enter**. For Class 10, the first three digits can be used when they identify one student; if multiple students match, select the correct student from the candidate list.
4. Enter the mark and press **Enter**. The mark is saved and the Admission Number field is ready for the next student.
5. Select **Finish** to review and complete the class marklist. The confirmation shows the number of active students who still have no result. When confirmed, every active, non-withdrawn student in the selected class and academic year without a saved mark is recorded as **Absent** (`marks = NULL`, `is_absent = 1`). Previously entered marks (including a score of zero) and existing Absent records are preserved. The complete marklist remains available for Excel export.

The Save Mark and Clear buttons remain available as mouse/touch alternatives. Existing marks trigger a replacement confirmation before being changed.

## Data integration

Marks are written directly into the existing `weekly_tests` and `weekly_test_marks` tables. The matching test is keyed by academic year, test date, class, subject and topic. The first saved mark creates the corresponding `weekly_tests` row; each student mark is stored in `weekly_test_marks`. As a result, marks are immediately visible in the normal Weekly Tests register, weekly reports, student performance reports and Parent Portal. No duplicate mark-entry table is created.

Excel export remains available from the entered marklist and exports the currently selected Weekly Test.

## Resuming interrupted mark entry

Every Weekly Test now has an entry status. A test created through Quick Mark Entry is created in the Weekly Tests register and marked **In Progress** as soon as Start / Resume is pressed, even before the first mark is saved. If the administrator closes the portal or browser before pressing Finish, the existing `weekly_tests` row and all saved `weekly_test_marks` remain in the database, with the status still set to `in_progress`.

To continue later, open **Weekly Tests** and select **Resume Entry** for an in-progress test. The Mark Entry screen restores the original date, class, subject, topic and maximum marks, loads all already-saved marks, and focuses the Admission Number field for the next student. Completed or imported tests can also be reopened using **Open / Edit Marks**.

Pressing **Finish** records missing students as Absent and writes `entry_status = 'completed'`. The operation is atomic, so all missing results and the completed status are saved together. Reopening a completed test changes it back to **In Progress** until Finish is pressed again; students already recorded as Absent can then be given a mark by confirming the replacement prompt. Existing databases are upgraded automatically with a `weekly_tests.entry_status` column; old tests default to **Finished** and remain available through Open / Edit Marks.
