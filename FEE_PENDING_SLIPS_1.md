# Fee Pending Slip Generation

The Admin navigation includes **Fee Pending Slips**. Select a class and division, enter the cumulative amount each student should have paid by the due date, and choose the due date. The tool previews and prints individual reminders in Malayalam using **Noto Sans Malayalam** (loaded through Google Fonts, with Malayalam system-font fallbacks). Four slips are arranged per A4 page (2 × 2).

## Printed slip content
- Parent message: “പ്രിയപ്പെട്ട രക്ഷിതാവേ, സ്ഥാപനത്തിൽ ഇതുവരെ അടച്ച ഫീസ് വിവരങ്ങൾ താഴെ കൊടുക്കുന്നു. അടയ്ക്കാൻ ബാക്കിയുള്ള തുക താഴെ നൽകിയിരിക്കുന്ന തീയതിക്കുള്ളിൽ അടയ്ക്കണമെന്ന് അറിയിക്കുന്നു.”
- The student identifier is labelled **അഡ്മിഷൻ നമ്പർ**.
- The fee summary contains exactly three boxes: **ആകെ ഫീസ്**, **ആകെ അടച്ചത്**, and **അടക്കേണ്ട തുക**.
- The main highlighted box displays the due-date heading (for example, **2026 നവംബർ 4-ന് മുമ്പ് അടയ്ക്കേണ്ട തുക**) and the amount requested.
- The additional explanatory sentence beneath the highlighted requested amount has been removed.

## Class and division selection
- Class options are derived from the active student register for the selected academic year.
- After selecting a class, the Division dropdown shows only divisions present in that class.
- Both Class and Division are required. Only students matching that exact class/division combination are included.

## Collection calculation

The entered target is a **cumulative paid-fee target**, not the amount to request directly. For each active student:

`Amount requested = min(max(Target amount − Amount already paid, 0), Actual outstanding balance)`

For example, if the target is ₹12,000 and a student has already paid ₹11,000, the slip requests ₹1,000 (provided at least ₹1,000 is still outstanding). A student who has already paid ₹12,000 or more is excluded. If the actual outstanding balance is only ₹500, the slip requests ₹500 rather than exceeding the student's balance.

## Behaviour
- Loads active students in the currently selected academic year. Withdrawn students are excluded by the existing Students API.
- Includes only students in the selected Class and Division who have not reached the cumulative paid target and still have an outstanding balance.
- Shows amount already paid, cumulative target, actual outstanding balance and requested amount in the admin preview.
- Prints the three-box fee summary, Malayalam parent message, Malayalam due-date heading and signature text. Student names and admission numbers remain as stored in the database.
- Prints four individual slips per A4 page (2 × 2).
- Waits for Noto Sans Malayalam to load before invoking the browser print dialog; Nirmala UI/Kartika/sans-serif are configured fallbacks if the web font is unavailable.
- Uses live fee balances and payment totals each time Generate Slips is clicked.
- Does not create payment records, store generated slips, change balances, or modify the database.

## Test
1. Choose an academic year from the existing year switcher.
2. Open **Fee Pending Slips**.
3. Select a class, then select one of the divisions populated for that class.
4. Enter a positive cumulative paid target and choose a due date.
5. Generate and review the preview. Confirm the class/division label and list are correct.
6. Confirm a student who paid ₹11,000 against a ₹12,000 target is asked for ₹1,000, a student who has already paid the target is excluded, and no request exceeds the student's actual outstanding balance.
7. Print all slips and confirm the corrected Malayalam message, **അഡ്മിഷൻ നമ്പർ** label, three-box fee summary, highlighted due-date amount, Noto Sans Malayalam rendering, and four-up A4 alignment.
