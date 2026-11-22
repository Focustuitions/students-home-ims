# Bulk Submission Marking

The Admin Assignment Portal and Late Arrival Additional Work portal include the same preview-first bulk marking flow.

## Workflow

1. **Submission Window:** choose a start and end date. The dates filter on each record's **Due Date**, inclusive.
2. **Admission Numbers:** paste full Admission Numbers or unambiguous numeric prefixes. Separate entries with newlines, spaces, commas, or semicolons. A maximum of 500 inputs is accepted.
3. **Preview:** the portal resolves each student and lists every pending work item for those students due within the selected window. Duplicate, ambiguous, invalid, unmatched, and no-pending-in-window entries are identified.
4. **Submit:** confirm the exact previewed records. The records are marked `Submitted`, with today's local browser date and `submitted_by = 'Admin'`.

All pending items for a listed student within the selected window are included. Items due outside the selected window, items already submitted, and items belonging to withdrawn students are not changed. The user must review the individual records in the preview before submitting.

## API

- `POST /api/assignments/bulk-submission/preview`
- `POST /api/assignments/bulk-submission/submit`
- `POST /api/late-arrivals/bulk-submission/preview`
- `POST /api/late-arrivals/bulk-submission/submit`

Preview requests include `window_from`, `window_to`, `admission_numbers`, and `academic_year_id`. Submit requests additionally include the exact previewed `record_ids` and `submitted_date`. The submit endpoints revalidate the selected records and update them transactionally; if any previewed item has changed status or is no longer eligible, the batch is rejected and must be previewed again.

## Database

No schema change or migration is required. Existing `submission_status`, `submitted_date`, and `submitted_by` fields are used. Existing individual Mark Submitted / Mark Pending actions remain available.
