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
