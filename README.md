# SimpleStock v22.7 — Embedded Demo Photos

This version removes the separate `demo-images/` dependency.

## Fix
Demo photos are compressed and embedded directly inside `app.js`.

That means:
- No `demo-images` GitHub folder is required
- No broken image paths
- No image-folder deployment mistakes
- No separate PWA image-cache issue
- Try Demo should show photos as soon as the new `app.js` is deployed

## Important
You can delete the `demo-images/` folder from GitHub after this version is working. It is no longer used.

The embedded demo photos are small thumbnails intended only for demo inventory cards.
