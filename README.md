# Inventory Tracker Base v1

A clean, reusable, mobile-friendly inventory and asset tracker starter that can be customized for warehouses, resellers, equipment operations, estate sales, contractors, and small businesses.

## Core workflow

Add Item → Search → Update Quantity / Location / Status → View History

## Included

- Mobile-friendly inventory dashboard
- Real-time search
- Item name, ID/barcode, category, quantity, low-stock threshold, location, status, photo URL, notes
- Statuses: In Stock, Checked Out, Sold, Reserved, Needs Attention
- Low-stock and needs-attention dashboard filters
- Admin mode for adding/editing/deleting
- Audit history
- Browser localStorage persistence
- Demo starter inventory
- Netlify-ready static files

## Demo admin PIN

`1234`

Change `ADMIN_PIN` near the top of `app.js` before using this with a customer.

## Deploy to Netlify

Upload this folder as a static site or push the files to a GitHub repository connected to Netlify. No build command is required.

## What to customize next

Keep this repository generic. Clone it to create industry versions, for example:

- Reseller Tracker: purchase cost, asking price, sold price, platform, fees, profit
- Equipment Tracker: employee/project assignment, checkout/return dates, condition
- Estate Sale Tracker: room, asking price, discount schedule, disposition
- Warehouse Tracker: vendor, PO, receiver, project/property, reorder point

## Important

This v1 stores data in the browser. For multi-user/customer deployments, the next step should be replacing localStorage with a shared database and authentication.
