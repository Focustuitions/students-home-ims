# Class-wide Assignment Preview Fix

## Issue
When the checkbox **Assign to the entire class (all divisions)** was enabled, the Preview action could still return **Select a class and division**, because the API only recognized `target_scope: "entire_class"` and would fall back to division mode if the checkbox state arrived separately or the browser was running a stale script.

## Fix
- The Admin form sends both `target_scope: "entire_class"` and `entire_class: true` when the checkbox is checked.
- The assignments API accepts either signal and normalizes it to the same entire-class mode.
- Entire-class mode requires a class, but does not require a division or a manual Admission Number list.
- Division mode still requires both class and division.
- Updated the browser script version so the stale client-side validation is refreshed.
- Improved the validation message to explain that users can either choose a division or enable entire-class mode.

## Expected workflow
1. Choose Given Date, Teacher, Subject and Class.
2. Tick **Assign to the entire class (all divisions)**.
3. Enter Due Date and assignment details.
4. Click **Preview Students**. All active students in the selected class and academic year should appear across divisions.
5. Confirm and create assignments.

No database changes or migrations are required.
