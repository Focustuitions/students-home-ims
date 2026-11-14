# Parent Performance Sheet Update

The Parent Portal home page now links to the same Student Performance Sheet design and calculations used by the administrator portal, replacing the previous Progress Report.

The parent report calls `/api/parents/performance-report`. This endpoint requires parent authentication and derives the admission number only from the authenticated parent session; it does not accept an admission number from the URL or request body. It reuses the administrator report calculation handler, preserving the weekly-test trends, subject strengths/weaknesses, class comparisons, term exam summaries, Hot Seat observations, and risk flags.

The report can be printed or saved as PDF using the browser print dialog. No database migration is required. Keep the existing `DB_PATH` and database unchanged.
