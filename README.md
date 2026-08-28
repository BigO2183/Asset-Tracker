# SimpleStock v11 — Optional Estate Sale Mode

Keeps the working reseller flow intact and adds a separate Estate Sale workflow.

## Mode switch
Use the compact switch above Search:
- **Reseller**
- **Estate Sale**

Existing inventory defaults to Reseller.

## Estate Sale Mode
Fast intake stays simple:
- Photo
- Item name
- Tag price
- Room / location
- Save / Save + Add Another

Optional details include:
- Category
- Sale stage: Full Price / 25% Off / 50% Off / Final Price
- Final price
- Status / disposition

Estate statuses:
- For Sale
- Hold
- Sold
- Family Keep
- Donate
- Bulk Buyer
- Dispose

The inventory card shows the current discounted price automatically.

## Cloud Sync
The same Netlify Blobs cloud sync remains in place, so estate-sale items also sync between phone and desktop.

## Deploy
Replace the entire project in your GitHub repo, preserving:
`netlify/functions/inventory.mjs`

Demo Admin PIN: `1234`
