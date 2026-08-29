# SimpleStock v25 — Early Access Control

Built to manage a controlled reseller testing round.

## Platform Admin Controls
Settings → Early Access Control

The account matching Netlify environment variable:

`SIMPLESTOCK_ADMIN_EMAIL`

can:
- turn new workspace signups ON/OFF
- require an invite code
- set/change the invite code
- clear the invite code
- view Signup Inbox
- import older workspaces

## Signup Inbox
Now shows:
- workspace name
- signup email
- reseller / estate mode
- joined date
- last login
- last activity
- number of inventory items
- number sold
- number of workspace users

No inventory details are exposed in the platform inbox.

## Early Access Label
The app now visibly shows an **Early Access** badge.

## Bug Reports
A separate **Report Bug** button is included.
Bug reports are stored alongside feedback but clearly labeled as bugs.

## Feedback Security
Feedback Inbox is now limited to the platform admin email instead of every workspace owner.

## Signup Rules
Existing users can always sign in.

Only NEW workspace creation is affected by:
- Signup Enabled / Disabled
- Invite Code Required

## Recommended Test Setup
1. Set `SIMPLESTOCK_ADMIN_EMAIL` in Netlify.
2. Deploy v25.
3. Sign in as platform admin.
4. Settings → Early Access Control.
5. Set an invite code.
6. Turn on Require Invite Code.
7. Keep New Signups enabled while recruiting testers.
8. Turn New Signups off when you have enough testers.
