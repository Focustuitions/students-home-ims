# Admin Dashboard: Top 20 Pending Fee Students

Added a dashboard section titled **Top 20 Students with Highest Pending Fee**.

- Uses the existing `balance` value supplied by `GET /api/students`, preserving the application's current fee calculation (`max(net_fees - recorded payments, 0)`).
- Respects the academic year currently selected in the admin dashboard.
- Excludes students with zero or negative pending balances.
- Sorts by highest outstanding balance first and displays at most 20 students.
- Displays rank, admission number, student name, class/division, net fee, paid amount, and pending amount.
- Each row opens the existing student detail page when clicked.
- No database schema or data migration is required.

## Deployment

Deploy the application files as usual. Keep the existing `DB_PATH` and production database unchanged. The update only changes the admin dashboard HTML template and client-side dashboard rendering.
