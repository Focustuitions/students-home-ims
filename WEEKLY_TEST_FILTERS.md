# Weekly Tests Register — Search & Filters

The Admin Portal Weekly Tests register now includes a combined search and filter toolbar.

- **Search:** searches test date, exam name, subject, topic, class, and maximum marks.
- **Class:** filters the test register by the class stored on each weekly test.
- **Subject:** filters by subject, using the exam name when a legacy record has no separate subject value.
- **Month:** filters by the test date's month and year.
- **Combined filters:** search text and all three dropdown filters apply together.
- **Clear Filters:** resets all criteria and restores the full academic-year register.
- **Responsive layout:** the filter toolbar collapses to a touch-friendly layout on smaller screens; results remain horizontally scrollable where needed.

The filters are client-side and use the existing `/api/weekly-tests` response for the selected academic year. No database schema, data, or API changes are required.
