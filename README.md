# Equipment Asset Tracker MVP

A lightweight static starter for tracking equipment assets. It is designed for GitHub + Netlify and can connect to Supabase when you are ready.

## What Is Included

- `index.html` - app structure
- `styles.css` - responsive layout and styling
- `app.js` - Supabase connection placeholders, starter fallback data, history, and simple checkout/return logic
- One test asset: `EQ-001`, Milwaukee Drill, status `Available`
- Browser-only checkout and return buttons for the first workflow test
- Supabase-ready equipment and checkout history logic
- Browser storage fallback until your Supabase values are pasted into `app.js`
- Direct asset QR code display and print button

## Run Locally

Open `index.html` in your browser.

No install step is required.

## Connect Supabase

In `app.js`, replace these two placeholder values:

```js
const supabaseUrl = "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE";
const supabaseAnonKey = "PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE";
```

Use your Supabase **Project URL** and **anon public key**. Do not use the `service_role` key.

After saving, upload the changed `app.js` and `index.html` to GitHub. Netlify should redeploy automatically.

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

- Add more equipment records in Supabase.
- Add basic sign-in before letting a full team use the tracker.

## Asset Links For QR Codes

Each asset can open directly with an `asset` value in the URL:

```text
https://your-site-name.netlify.app/?asset=EQ-001
```

Use that URL when creating a QR code for the asset.

The app also shows a QR code in the asset detail view. Use **Print QR** to print the current asset label.

Keep the first version simple: list equipment, open one asset, confirm the status.
