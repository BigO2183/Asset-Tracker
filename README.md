# SimpleStock v9.4 — Mobile Save Fix

This version fixes a likely mobile-only save failure caused by full-resolution phone photos exceeding browser localStorage limits.

## Fixes
- Mobile photos are automatically resized to a maximum dimension of 1200px.
- Photos are compressed to JPEG before being stored.
- Save failures now show a visible error instead of silently doing nothing.
- Save Item still returns directly to Inventory.
- Save + Add Another still remains in intake mode.

## Why this matters
Modern phone camera photos can be several megabytes each. Saving the raw base64 photo directly into localStorage can exceed the browser's storage quota very quickly.

Demo Admin PIN: `1234`
