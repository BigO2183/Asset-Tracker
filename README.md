# SimpleStock v22.6 — Demo Photo Cache Fix

Fixes demo photos not appearing in the installed Android PWA.

## Changes
- Demo photo paths changed to absolute `/demo-images/...`
- Service-worker cache bumped to `simplestock-v22-6-shell`
- Demo images explicitly added to the app-shell cache
- Android installed app will fetch the new demo assets after redeploy

## After deploying
1. Wait for Netlify to say Published.
2. On Android, fully close SimpleStock.
3. Reopen it.
4. If photos still do not update, Chrome → Site settings → your Netlify site → Clear & reset.
5. Reopen the live site once in Chrome, then reopen the installed app.
