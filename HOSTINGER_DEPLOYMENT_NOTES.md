# Deployment notes — Students' Home IMS

- Runtime: Node.js 22 or newer.
- Start command: `npm start`.
- Keep the existing `DB_PATH` environment variable pointed at the same private, persistent SQLite database location.
- This package does not include the live SQLite database; do not replace the existing database when deploying the code update.
- No database migration is required for the keyboard-driven Mark Entry refinement.
- Mark Entry saves directly into the existing `weekly_tests` and `weekly_test_marks` tables. There is no separate Mark Entry data store.

After deployment, test one non-production/known student mark and confirm that it appears in Admin → Weekly Tests and in the corresponding Weekly Test report before using the feature for routine entry.

### Mark Entry resume-status migration

On first startup after this update, the app safely adds `weekly_tests.entry_status` (default `completed`) if it is not already present. Do not replace the persistent SQLite database. Back it up before deployment as usual. In-progress sessions can then be resumed from the Weekly Tests register.

### Impositions & Assignments update
The application creates the `assignment_teachers` and `student_assignments` tables and seeds the default subject-teacher roster automatically at startup. No manual database migration or replacement is needed. Keep the existing persistent `DB_PATH` unchanged.

Teacher Portal imposition entry now supports batch admission-number input with a preview and explicit confirmation. It uses the existing `student_assignments` table; no additional database migration is required. Keep the persistent `DB_PATH` unchanged during deployment.

### Assignment submission tracking update
The application automatically adds `due_date`, `submission_status`, `submitted_date`, and `submitted_by` columns to the existing `student_assignments` table. Existing assignment records are retained, assigned a default due date one day after their given date, and initially shown as Pending. No separate database upload is needed; keep the existing persistent `DB_PATH` unchanged and take a backup before deploying.


### Late Arrival Additional Work
The application creates the `late_arrival_works` table and indexes automatically on startup. Keep the existing persistent SQLite file and `DB_PATH`; do not upload a fresh database. Late-arrival records are retrieved by the shared Student Performance Report handler and therefore appear in both the Admin performance report and authenticated Parent Performance Sheet. Back up the database before deploying, then test creating a small late-arrival batch, marking one submitted, deleting a test record, and confirming the student's performance report updates accordingly.

## Pending report exports

This update adds Excel download routes for `/api/assignments/pending/export` and `/api/late-arrivals/pending/export`. The existing `/api/late-arrivals/export` remains the full/filterable Late Arrival register export. No schema migration or environment-variable change is required.


### Late Arrival all-class batch entry refinement
The Late Arrival entry form no longer requires class or division. Admin can submit a mixed batch of Admission Numbers across all classes and divisions for the selected academic year. The preview identifies each student's current class/division; numeric prefixes are resolved globally, with Class 10 requiring at least three digits and Classes 8/9 at least four. Ambiguous matches require the full Admission Number. Register class/division filters and Excel export filters remain available. No database migration is required.
