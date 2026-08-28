# SimpleStock v10 — Shared Phone + Browser Sync

This version replaces device-only inventory with shared cloud data when deployed on Netlify.

## What changes
- Save an item on your phone → it is stored in Netlify Blobs.
- Open the same deployed site on your computer → the same inventory loads.
- Edit, sell, or delete an item on either device → the shared cloud copy updates.
- Browser localStorage remains as an offline / fallback copy.
- Existing local inventory is migrated into cloud storage on the first cloud-enabled launch.

## Deployment
Upload/deploy the whole project to Netlify, including:
- `netlify/functions/inventory.mjs`
- `netlify.toml`
- `package.json`

Netlify installs `@netlify/blobs` during deployment.

## Important
Both phone and computer must open the **same deployed Netlify site**.

This version uses one shared inventory workspace. User accounts / separate customer workspaces are not added yet.

## Demo Admin PIN
`1234`
