# Mobile UI refinement

This update applies a consistent responsive layout to all 15 public HTML pages.

## Admin Portal
- Adds a compact sticky mobile app bar and an accessible slide-out navigation drawer.
- Keeps all navigation destinations available without a permanently visible desktop sidebar.
- Improves page headings, cards, stat grids, form fields, filters, action groups, pagination, and status notifications for narrow screens.
- Keeps dense registers and reports readable with touch-friendly horizontal table scrolling rather than compressing or hiding columns.
- Adds safe-area spacing and larger touch targets.

## Teacher Portal
- Refines the header and account controls for mobile widths.
- Uses single-column entry forms, larger form controls, stacked action buttons, and swipeable register/preview tables.

## Parent Portal and standalone pages
- Refines the Parent Portal dashboard, profile layout, academic links, and payment tables.
- Improves login pages, academic reports, printable sheets, and receipts for on-screen mobile viewing while retaining print-specific layouts.

## Technical notes
- Adds `public/css/mobile.css` and links it from every HTML page.
- Adds the Admin Portal mobile navigation controls and keyboard/backdrop close behavior.
- No server routes, database schema, database path, authentication rules, or deployment configuration were changed.
