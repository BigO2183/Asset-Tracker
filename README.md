# SimpleStock v18 — Business Workspaces

This version turns SimpleStock from one shared tracker into separate private business workspaces.

## First-run setup
Create a workspace with:
- Business / workspace name
- Owner email
- Password
- Starting mode: Reseller or Estate Sale

## Login
Owners sign in with email + password.

## Separate data
Each workspace gets its own Netlify Blobs inventory key:

`workspace:<workspace-id>:inventory-state`

Inventory, sales, history, reports, and cloud sync are isolated by workspace.

## Owner role
The first account is the workspace **Owner** and has full add/edit/delete access.

Staff accounts are intentionally left for a later version.

## Logout
The old Admin button is now **Sign out**.

## Backend
New function:
- `netlify/functions/auth.mjs`

Updated function:
- `netlify/functions/inventory.mjs`

## Security note
This is a strong prototype architecture using server-side password hashing, random session tokens, and private workspace data. Before a large public launch, move authentication to a dedicated managed identity provider and add account recovery / email verification.

## Deployment
Deploy the entire v18 project to Netlify, not only `index.html`.

Required:
- `app.js`
- `index.html`
- `styles.css`
- `package.json`
- `netlify.toml`
- `netlify/functions/auth.mjs`
- `netlify/functions/inventory.mjs`
