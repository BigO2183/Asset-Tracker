# SimpleStock v22.1 — Authentication Fix + Diagnostics

Fixes the vague "Unable to continue." login error.

## Changes
- Added `GET /.netlify/functions/auth?action=health`
- Login now reports whether the auth function is:
  - missing / 404
  - crashing / 500
  - unreachable
  - returning a normal account/password error
- Automatically migrates older owner accounts forward with missing v21/v22 fields.
- Bumped the PWA service-worker cache so Android receives the fixed `app.js`.

## Important GitHub structure

`auth.mjs` must be here:

`netlify/functions/auth.mjs`

and inventory must be here:

`netlify/functions/inventory.mjs`

Do not keep the backend `.mjs` files only at the repository root.
