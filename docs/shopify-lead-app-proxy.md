# Shopify lead app proxy

The Powerful Form Builder capture script sends lead data to a same-origin
Shopify App Proxy. Shopify forwards the request to RF Tools and signs every
query parameter with the app client secret. The client secret never appears in
storefront JavaScript or browser network requests.

## Shopify configuration

Configure the app associated with the store's `SHOPIFY_CLIENT_SECRET_N`:

- Subpath prefix: `apps`
- Subpath: `rf-leads`
- Proxy URL: `https://tools.rftransparent.ca/api/customer-service/leads/webhook`

The resulting storefront URL is `/apps/rf-leads`. Paste
`docs/shopify-lead-capture.js` into Powerful Form Builder's "After form loaded"
script after the proxy is configured.

## Deployment order

1. Apply `20260807135000_lead_ingestion_rate_limits.sql`.
2. Configure the Shopify App Proxy.
3. Deploy the RF Tools application.
4. Replace the Powerful Form Builder script with `docs/shopify-lead-capture.js`.
5. Submit one test lead with and without an attachment.

Requests fail closed when the signature cannot be verified or the persistent
rate limiter is unavailable. The retired `LEADS_WEBHOOK_SECRET` environment
variable can be removed.
