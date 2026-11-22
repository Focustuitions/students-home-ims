# Parent Portal Fees Removal and Class-Wide Assignments

## Parent Portal
- Removed all fee summary cards, fee payment history, fee discount display, and fee values from the parent dashboard API response.
- Admin Finance pages and payment APIs remain unchanged.
- Parent academic records, assignments, attendance and performance reporting remain available.

## Class-Wide Assignments
- Admin Assignment Portal includes an `Assign to the entire class (all divisions)` option.
- Selecting a class in this mode loads every active student in that class across all divisions for the current academic year.
- The preview lists each student and division before confirmation.
- Existing duplicate detection marks previously recorded assignments as `Already recorded` and excludes them from the create batch.
- Saving creates one normal `student_assignments` row per eligible student; this preserves the existing submission, history, reverse, parent-report and teacher-portal workflows.
- The server verifies that the active roster has not changed since preview. If it has, the save is rejected and the admin must preview again.
- The existing division-specific and manual Admission Number workflow remains unchanged.

No database schema migration is required.
