# Export Options Update

The Admin portal now provides dedicated Excel exports for:

- **Late Arrival Work Register**: the existing `Export All Records (Excel)` action exports all rows matching the current Late Arrival register filters.
- **Pending Late Arrival Work**: `Export Pending Records` exports all active-student late-arrival work that has not been submitted. Past-due items are labelled `Overdue`.
- **Pending Assignments**: `Export Pending Report` exports all active-student assignments that have not been submitted. Past-due items are labelled `Overdue`.
- **Assignment Register**: the existing `Export Excel` action remains and exports rows matching the current register filters.

The pending reports include the student Admission Number, student name, class, division, given/late-arrival date, due date, work type/details, and assignment subject/teacher where applicable. The exports use the selected academic year. No database migration is required.
