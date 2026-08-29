# SimpleStock v24.1 — Signup Backfill

Adds a one-time import for existing SimpleStock workspaces.

## Signup Inbox
Settings → Signup Inbox

New button:
**Import Existing**

When the platform admin clicks it, SimpleStock:
- scans existing auth users
- identifies unique workspace IDs
- reads workspace metadata
- backfills one signup record per workspace
- avoids duplicates
- keeps all future signup logging active

## After deploying
1. Sign in with the email configured in `SIMPLESTOCK_ADMIN_EMAIL`.
2. Open Settings.
3. Open Signup Inbox.
4. Click **Import Existing** once.
5. Existing workspaces should appear.
6. Future signups continue appearing automatically.

Backfilled records are marked internally as `backfilled: true`.
