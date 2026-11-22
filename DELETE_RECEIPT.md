# Delete Receipt

The Admin Portal now provides a Delete action beside receipts in:

- Student Profile → Fee Ledger
- Payment History
- Dashboard → Recent Payments
- Edit Fee Receipt

Deleting a receipt permanently removes that payment entry. The confirmation dialog shows the receipt number, amount, date and student, and warns that the student's paid total and outstanding balance will be recalculated. Student, parent and dashboard fee totals are calculated from the payments ledger, so the change is reflected on refresh.

Only an authenticated administrator can call the deletion endpoint. The receipt sequence is deliberately not rolled back after a deletion, preventing an old receipt number from being suggested and reused.

No database migration is required. Back up the SQLite database before deleting any real payment record.
