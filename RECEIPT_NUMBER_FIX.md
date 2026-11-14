# Receipt number sequence fix

This update keeps the receipt sequence in the application's SQLite database.
On first startup with an existing database, the sequence is initialized from the
highest existing numeric receipt number. After that, the last numeric receipt
number saved in a new payment or selected while editing a receipt becomes the
basis for the next suggestion. For example, saving receipt `555` causes the
next suggestion to be `556`, even if older historical receipts include `900`.
Non-numeric labels such as `OB-...` do not change the numeric sequence, and
leading zeros are preserved.

No database backup is included in this deployment ZIP. The sequence table is
created automatically in the persistent database when the application starts.
