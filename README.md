# SimpleStock v19.1 — Android PWA Fix

This version fixes Android installation / icon recognition.

## Changes
- Replaced SVG PWA icons with PNG icons.
- Added 192×192 PNG.
- Added 512×512 PNG.
- Added a separate 512×512 maskable Android icon.
- Updated the web manifest.
- Added a stable app `id`.
- Bumped the service-worker cache version so Chrome fetches the new files.
- Updated favicon / Apple touch icon references.

## GitHub icon folder
Upload these files inside `icons/`:
- `icon-192.png`
- `icon-512.png`
- `icon-maskable-512.png`

## After deploying
On Android Chrome:
1. Remove any old SimpleStock shortcut that was created.
2. Chrome → Settings → Site settings → All sites → your Netlify site → Clear & reset, OR clear the site's cached data.
3. Reopen the live Netlify URL.
4. Wait a few seconds / refresh once.
5. Chrome menu should recognize the installable app more reliably.
6. Choose **Install app** if offered.

The installed icon should now use the SimpleStock navy inventory icon instead of the gray N.
