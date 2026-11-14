# Teacher Portal

## Admin setup
1. Sign in to the Admin Portal.
2. Open **Teacher Portal Accounts**.
3. Add the teacher name, a unique Teacher Code, one or more subjects, and one or more classes handled.
4. Copy the generated temporary password and share it privately with the teacher. The temporary password is displayed only once; Admin can reset it to generate another one.
5. Teachers sign in at `/teacher-login.html` using Teacher Code and temporary password, then set a private password (minimum 8 characters).

## Teacher workflow
1. Open `/teacher-login.html`.
2. Select an assigned class and subject, and confirm the given date.
3. Enter the Admission Number prefix and press Enter. Class 10 requires at least 3 leading digits; Classes 8 and 9 require at least 4. Other classes require at least 3.
4. Select the student if multiple students match, then save the imposition. The form clears to accept the next student.

Teachers can only access students in assigned classes and subjects assigned to their account. These checks are enforced by the server. Withdrawn students are excluded. Records are saved immediately into the existing `student_assignments` table and appear in the Admin **Impositions & Assignments** register.

## Credentials and sessions
- Teacher Code is the login ID.
- A random temporary password is generated at account creation/reset and stored only as a bcrypt hash.
- First sign-in requires a new password (at least 8 characters).
- Teacher sessions are separate from Admin and Parent sessions and expire after 12 hours.
- Admin can edit teacher permissions, reset passwords, or deactivate access.

## Database changes
The app creates `teacher_portal_accounts`, `teacher_portal_sessions`, and `teacher_login_attempts` automatically. It adds `teacher_account_id` to `student_assignments` to keep each teacher's recent activity associated with their account. Existing student, fee, payment, test and assignment records are preserved. Keep the existing `DB_PATH` unchanged.
