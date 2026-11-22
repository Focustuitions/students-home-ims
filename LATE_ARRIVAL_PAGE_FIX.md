# Late Arrival Work Page Fix

## Issue
The Late Arrival Work page failed during initial load with `assignmentPages is not defined`.

## Cause
The Late Arrival Work register called `assignmentPages.register.page = 1`, but `assignmentPages` is declared inside `renderAssignments()` and is not available to the separate `renderLateArrivalWork()` function.

## Fix
Removed the invalid cross-page pagination reference from the Late Arrival Work register loader. Kept the pagination reset inside the Assignment Portal, where that state is declared and used. Updated the `app.js` query-string version in `public/index.html` so browsers fetch the corrected script instead of using a cached copy.

No database changes, routes, or attendance/late-arrival business logic were changed.
