# SimpleStock v24 — Signup Monitor

Every new workspace registration is now recorded.

## Signup Inbox
Platform admin can open:

Settings → Signup Inbox

It shows:
- total signups
- workspace name
- account email
- Reseller / Estate Sale mode
- signup date/time
- workspace ID

## Platform Admin Setup
In Netlify environment variables, set:

`SIMPLESTOCK_ADMIN_EMAIL`

to the email address of the SimpleStock account that should be allowed to see all signups.

Only that signed-in account can access the Signup Inbox.

## Optional Email Alerts
To receive an email whenever someone creates a workspace, also set:

`SIGNUP_NOTIFY_EMAIL`
- email address that should receive signup alerts

`RESEND_API_KEY`
- API key from Resend

`RESEND_FROM_EMAIL`
- verified sender address in Resend, such as:
  `SimpleStock <notifications@yourdomain.com>`

If the email variables are not configured, signup logging still works normally. Email alerts are simply skipped.

## New storage
Signups are stored privately in Netlify Blobs:

`simplestock-signups`

## Backend change
`netlify/functions/auth.mjs` changed, so deploy the whole project.
