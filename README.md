# Equipment Asset Tracker MVP

A lightweight static starter for tracking equipment assets. It is designed for GitHub + Netlify and intentionally uses one hardcoded test asset for now.

## What Is Included

- `index.html` - app structure
- `styles.css` - responsive layout and styling
- `app.js` - hardcoded equipment data and detail view logic
- One test asset: `EQ-001`, Milwaukee Drill, status `Available`

## Run Locally

Open `index.html` in your browser.

No install step is required.

## Deploy With GitHub + Netlify

1. Create a new GitHub repository.
2. Add these files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `README.md`
3. Commit and push the files to GitHub.
4. In Netlify, choose **Add new site**.
5. Select **Import an existing project**.
6. Connect the GitHub repository.
7. Leave the build command blank.
8. Set the publish directory to `/` if the files are in the repository root.
9. Deploy the site.

## Easy Next Steps

- Replace the hardcoded array in `app.js` with Supabase equipment records.
- Add checkout and return buttons.
- Create a checkout history table.
- Add QR codes that open an asset detail page by Asset ID.

Keep the first version simple: list equipment, open one asset, confirm the status.
