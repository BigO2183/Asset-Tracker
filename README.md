# SimpleStock v17.1 — Reports Runtime Fix

Fixes the v17 startup issue.

## What was wrong
The Reports section existed in the page, but the `showReportsBtn` navigation button was missing from the HTML. JavaScript tried to access that missing element during startup and stopped execution.

Symptoms:
- Inventory did not load
- Sales & History did not respond
- Export did not respond
- Reports button was missing

## Fixed
- Added the Reports navigation button
- Added defensive optional chaining to report/navigation listeners
- Made the mobile navigation horizontally scrollable if needed
- Verified critical UI element IDs exist
- JavaScript syntax check passed

All v16/v17 features remain intact.
