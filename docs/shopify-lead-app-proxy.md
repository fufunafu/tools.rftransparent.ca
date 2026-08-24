# Shopify lead app proxy

The Powerful Form Builder capture script sends lead data to a same-origin
Shopify App Proxy. Shopify forwards the request to RF Tools and signs every
query parameter with the app client secret. The client secret never appears in
storefront JavaScript or browser network requests.

## Shopify configuration

Configure the app associated with the store's `SHOPIFY_APP_PROXY_SECRET_N`:

- Subpath prefix: `apps`
- Subpath: `rf-leads`
- Proxy URL: `https://tools.rftransparent.ca/api/customer-service/leads/webhook`

The resulting storefront URL is `/apps/rf-leads`. Paste
`docs/shopify-lead-capture.js` into Powerful Form Builder's "After form loaded"
script after the proxy is configured. Remove the retired capture code from
both "After form loaded" and "After form submitted" first, then install the
new script only in "After form loaded".

Shopify forwards a request to the proxy root with a trailing slash. RF Tools
handles that slash with an internal rewrite so the signed POST body is never
redirected to the storefront domain.

Set `SHOPIFY_APP_PROXY_SECRET_N` to the client secret from the same app that
owns this App Proxy configuration. If the Admin API and App Proxy use the same
Shopify app, RF Tools falls back to `SHOPIFY_CLIENT_SECRET_N`.

## RF vs BC

Both stores post to the same proxy URL. RF Tools tags each lead with a
`store_id` (`rf_transparent` or `bc_transparent`) based on which shop signed
the request: `SHOPIFY_STORE_1`/`_2` → RF, `SHOPIFY_STORE_3` (Montreal) → BC,
via `src/lib/store-scopes.ts`. Unknown shops fall back to RF.

To turn on BC website leads:

1. In the BC store's Shopify app (the one behind `SHOPIFY_STORE_3`), add the
   same App Proxy (`apps` / `rf-leads` → the webhook URL above).
2. Make sure `SHOPIFY_APP_PROXY_SECRET_3` (or `SHOPIFY_CLIENT_SECRET_3`) is set
   to that app's client secret.
3. Install `docs/shopify-lead-capture.js` in BC's Powerful Form Builder
   "After form loaded" script.
4. Submit a test lead and confirm it shows under "BC Transparent" on
   `/customer-service/leads`.

BC has no Meta lead ads; Meta leads are always stored as RF. New-lead emails
for BC go to `anne@cloture-verre.com`.

## Deployment order

1. Apply `20260807135000_lead_ingestion_rate_limits.sql` and any later
   corrective lead rate-limit migrations, plus
   `20260824120000_leads_store_id.sql` (adds `leads.store_id`; the app's
   lead queries select that column, so apply it before deploying).
2. Configure the Shopify App Proxy.
3. Deploy the RF Tools application.
4. Replace the Powerful Form Builder script with `docs/shopify-lead-capture.js`.
5. Submit one test lead with and without an attachment.

Requests fail closed when the signature cannot be verified or the persistent
rate limiter is unavailable. The retired `LEADS_WEBHOOK_SECRET` environment
variable can be removed.
