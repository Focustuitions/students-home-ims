# Desktop Viewport Fit Update

Updated the shared UI stylesheet and loaded it across every HTML page.

## Target viewports
- 1366 × 768: compact desktop spacing, compressed sidebar navigation, reduced card/form spacing, independently scrollable long registers.
- 1920 × 1080: wider content area with comfortable spacing and expanded dashboard/portal layouts.

## Coverage
- Admin dashboard and all Admin Portal sections.
- Teacher Portal and login screens.
- Parent Portal and academic detail pages.
- Student performance reports, weekly-test reports, term-exam reports, top-performer reports, receipts and other standalone pages.

## Behavior preserved
- Mobile stylesheet remains active below desktop breakpoints.
- Print styles are not overridden; report and receipt paper dimensions are retained.
- Database schema, API routes, application logic and stored records are unchanged.
- Long tables and long content continue to scroll where necessary instead of shrinking text to an unreadable size.
