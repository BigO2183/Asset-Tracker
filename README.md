# SimpleStock v21 — Business Ready

Major product-readiness update.

## Added
- Settings screen
- Workspace name + default mode settings
- Password change
- Recovery-code based forgot-password flow
- Staff accounts
  - Can edit
  - View only
- Owner staff management
- Activity log shows which user made each change
- JSON backup + restore
- Duplicate item
- Bulk select / status / move / delete
- Better first-use empty state
- Barcode / QR lookup using supported Android browser camera APIs
- Manual barcode / SKU lookup fallback
- Public product intro on sign-in screen
- Try Demo mode

## Password Recovery
When a workspace or staff account is created, SimpleStock generates a recovery code. Save it. It is required for self-service password recovery.

## Staff
Owner can add staff with a temporary password and choose:
- Can edit
- View only

## Barcode / QR
The Scan button uses the browser `BarcodeDetector` API when supported. Otherwise users can type/paste the code.

## Deployment
Deploy the entire project to Netlify because both backend functions changed:
- `netlify/functions/auth.mjs`
- `netlify/functions/inventory.mjs`

Existing PWA, cloud sync, reseller mode, estate sale mode, reports, quick sell, and mobile UI remain included.
