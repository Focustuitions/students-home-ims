# Teacher Portal

## Admin setup
1. Sign in to the Admin Portal.
2. Open **Teacher Portal Accounts**.
3. Add the teacher name, a unique Teacher Code, one or more subjects, and one or more classes handled.
4. Copy the generated 4-digit numeric password and share it privately with the teacher. It is displayed only when created or reset; Admin can reset it at any time.
5. Teachers sign in at `/teacher-login.html` using their Teacher Code and 4-digit numeric password. No 8-character password change is required.

## Teacher workflow
1. Open `/teacher-login.html`.
2. Select an assigned class and subject, and confirm the given date.
3. Enter the Admission Number prefix and press Enter. Class 10 requires at least 3 leading digits; Classes 8 and 9 require at least 4. Other classes require at least 3.
4. Select the student if multiple students match, then save the imposition. The form clears to accept the next student.

Teachers can only access students in assigned classes and subjects assigned to their account. These checks are enforced by the server. Withdrawn students are excluded. Records are saved immediately into the existing `student_assignments` table and appear in the Admin **Impositions & Assignments** register.

## Credentials and sessions
- Teacher Code is the login ID.
- A random 4-digit numeric login password is generated at account creation/reset and stored only as a bcrypt hash.
- Teacher passwords are exactly four numeric digits. Existing accounts with an older password can be moved to a 4-digit password by using Admin → Reset Password.
- Teacher sessions are separate from Admin and Parent sessions and expire after 12 hours.
- Admin can edit teacher permissions, reset passwords, or deactivate access.

## Database changes
The app creates `teacher_portal_accounts`, `teacher_portal_sessions`, and `teacher_login_attempts` automatically. It adds `teacher_account_id` to `student_assignments` to keep each teacher's recent activity associated with their account. Existing student, fee, payment, test and assignment records are preserved. Keep the existing `DB_PATH` unchanged.
## Shared imposition submission tracking
- Impositions assigned by Admin are linked to the matching active Teacher Portal account when the teacher name resolves uniquely.
- Teacher Portal lists the impositions explicitly linked to that teacher account by Admin, along with older unlinked records that uniquely match the teacher name within the teacher's permitted classes and subjects.
- Teachers can mark an imposition Submitted or return it to Pending from the Teacher Portal. Admin can do the same in Impositions & Assignments.
- Both portals update the same `student_assignments` row, so status, submitted date and submitted-by value remain synchronized. No database migration is required.

## Imposition entry deletion
- Admins can delete individual imposition rows from Admin → Impositions & Assignments.
- Teachers can delete individual imposition rows assigned to their account from Teacher Portal → Assigned Impositions & Submissions. The teacher-side server route enforces the same account/class/subject ownership scope used for status updates.
- Deletion requires confirmation, including student, class, subject, date and current submission status. It permanently removes that shared `student_assignments` row from both portals. No database migration is required.
