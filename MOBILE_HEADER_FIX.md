# Mobile header positioning fix

- Removed sticky positioning from the Admin mobile app bar so it no longer floats over page content while scrolling.
- Constrained the header to a predictable 56–60px height and the hamburger control to a 42–44px touch target.
- Hid the desktop sidebar gradient edge on mobile so no colored sliver remains visible beside the closed drawer.
- Added a CSS query version to force mobile browsers to fetch the updated stylesheet.

No database, authentication, API route, or business logic changes.
