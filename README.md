# SimpleStock v23.1 — Owner Feedback Inbox

Adds an owner-only feedback inbox inside Settings.

## Where feedback goes
Tester feedback is stored in Netlify Blobs under:

`simplestock-feedback`

## Owner Inbox
Settings → Feedback Inbox

Owners can:
- read tester type
- see whether they would use SimpleStock
- read what felt useful
- read what was confusing / annoying
- see what testers would remove
- see what they say is missing
- view optional contact info
- refresh the inbox

## Security
Only signed-in workspace owners can load the feedback inbox.

## Backend change
`netlify/functions/feedback.mjs` now supports:
- POST for public tester submissions
- GET for owner-only feedback retrieval
