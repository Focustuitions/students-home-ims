# Student Division Update (Excel Import)

The Import Data page includes a dedicated **Update Student Divisions** card.

## Excel columns

Required:
- `Admission No` — exact student admission number; used to find the existing record.
- `New Division` — destination division (for example A, B, C, D or M).

Optional:
- `Name (Optional)` — reference text only.
- `Class (Optional)` — if supplied, it is checked against the student's current class. A mismatch is skipped to help prevent incorrect updates.

Download the sample workbook from the card at `/templates/division-update-template.xlsx`.

## Import behavior

- Updates only `students.division`; no fee, payment, marks, parent login, student name or other fields are changed.
- Division values are trimmed and saved in uppercase.
- Withdrawn students are skipped and remain in the Left / Withdrawn register.
- Unknown Admission Numbers, blank divisions, duplicate Admission Numbers in the same workbook, and class mismatches are reported as skipped rows.
- Rows already using the requested division are counted as unchanged.
- Updates are wrapped in a database transaction; unexpected database errors roll back the batch.
- Admission numbers should be formatted as text in Excel, especially if they contain leading zeroes.

No schema migration or database replacement is required.
