# Reseller / Estate Inventory Tracker v1

A lightweight mobile-friendly reseller inventory tracker built from the reusable Inventory Tracker Base.

## Included
- Fast intake workflow with phone photo upload
- Item name, SKU, category, quantity and physical location
- Cost / asking price / sold price
- Platform tracking: eBay, Facebook Marketplace, local, estate sale, other
- Status workflow: Unlisted, Listed, Reserved, Sold, Donated, Bulk Sale, Needs Attention
- Date acquired + automatic inventory age
- 60+ day aging dashboard
- Needs Attention detection for missing price/location/platform and 90+ day inventory
- Fees, shipping and automatic net profit calculation
- Potential revenue, sold revenue and profit dashboard
- Search and filters
- Audit history
- CSV export
- Mobile-first responsive UI
- Demo data

## Demo Admin PIN
`1234`

Change `ADMIN_PIN` near the top of `app.js` before customer use.

## Storage
This version uses browser localStorage. It is ideal for demos and single-device use. For a real customer/multi-user deployment, connect it to a shared database/auth system so inventory synchronizes across devices.

## Deploy
The folder is static and can be deployed directly to Netlify, GitHub Pages, or any static host.
