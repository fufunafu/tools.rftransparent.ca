# Amazon US hardware uploader

The `/amazon` page and `/api/amazon` endpoint implement an administrator-only pilot for new, standalone, seller-fulfilled listings. The user approved Glass Railing Store hardware as the source on October 3, 2026. Glass is deferred.

## Scope and source

- Shopify `store2` is the only permitted source.
- `src/lib/amazon/catalog.ts` contains 21 reviewed hardware product IDs. New catalog products require review before inclusion. Glass panels, custom glass, and the mixed glass/hardware sample kit are excluded, including at the API boundary.
- A live, read-only catalog check found 72 hardware variants, no missing or duplicated SKUs, no missing images, and USD contextual prices for every variant. A later identifier check found 34 empty barcode fields and 38 containing internal SKUs, with no usable UPC/EAN candidates. Physical product identifiers and the actual packaging brand require owner confirmation. The store's base currency is CAD. Never relabel its base prices as USD.
- The source query requests Shopify US contextual pricing. Only actual USD values populate Amazon offers. A missing barcode is never converted into an exemption claim.
- Stock defaults to zero. Shopify stock is a reference, not automatically shared with Amazon. This version does not synchronize inventory, prices, orders, or variation families.

## Account connection

On October 3, 2026, the Solution Provider Portal registration and identity verification completed. The sandbox app `RF Tools Hardware Sandbox` was created with app ID `amzn1.sp.solution.ff2c89b5-bdf4-46e9-93fa-23241d6269bf`. Its client ID, client secret, and generated refresh token are stored under separate `AMAZON_SANDBOX_*` keys in ignored `.env.local`, with file permissions `0600`. No credential values belong in these notes or verification receipts.

The authenticated sandbox check passed at 18:31 UTC: Login with Amazon token exchange succeeded and `getListingsItem` returned HTTP 200 with Amazon's expected static listing fixture. See `amazon-sandbox-verification.json`. Run `node scripts/verify-amazon-sandbox.mjs` to repeat this read-only check. It has a fixed sandbox endpoint and test identifiers; it does not submit listings. Static fixture success verifies connectivity, not eligibility or completeness of real hardware listings.

The user requested sandbox development first, then authorized security implementation and profile submission. The initial October 3, 2026 profile was declined in case 22404325731. After correction of the password/MFA enforcement assessment and implementation of Suricata monitoring plus Vercel network restrictions, the private profile was resubmitted with all seven security answers Yes and Product Listing only. Amazon approved SP-API access in new case 22404482901 at 16:40 EDT on October 3, 2026. See `amazon-profile-resubmission.json`, `amazon-network-verification.json`, and `amazon-security-implementation.md`. No production SP-API credentials or live product uploads exist yet.

No Amazon products were submitted. The uploader and security gate are deployed at `https://tools.rftransparent.ca/amazon`; see `amazon-security-release-verification.json` for the verified release status. Production `AMAZON_SP_API_*` credentials remain unconfigured, so the uploader does not treat sandbox credentials as production readiness.

1. The primary user of the Professional seller account registers a private SP-API developer profile and application with the Product Listing role. Start with Seller Central, Apps and Services, Develop Apps, or the Solution Provider Portal if the account has migrated.
2. Self-authorize the private application for the seller account.
3. Install these server-side environment variables in the intended environment: `AMAZON_SP_API_CLIENT_ID`, `AMAZON_SP_API_CLIENT_SECRET`, `AMAZON_SP_API_REFRESH_TOKEN`, and `AMAZON_SP_API_SELLER_ID`.
4. Never commit their values or put them in a browser bundle. The setup response reports configuration presence only. A successful category search verifies actual access.
5. Test the initial spigot listing against the account's real product-type definition. Review brand, GTIN, dimensions, material, compliance, shipping template, USD price, and Amazon stock before submission.

Official documentation:

- [Private developer registration](https://developer-docs.amazon.com/sp-api/docs/register-as-a-private-developer)
- [Private app authorization](https://developer-docs.amazon.com/sp-api/docs/self-authorization)
- [Listing submission and preview](https://developer-docs.amazon.com/sp-api/reference/putlistingsitem)
- [Product type definitions](https://developer-docs.amazon.com/sp-api/reference/getdefinitionsproducttype)

## Operation and limits

Import up to 20 hardware variants per pilot batch, choose each product's Amazon category, and edit its category fields. The editor handles common nested objects, arrays, enums, and local definition references. It does not claim to evaluate the complete Amazon JSON Schema vocabulary. Amazon validation remains authoritative for conditional requirements and eligibility. Unsupported reference fields must be completed in Seller Central. Real account category schemas still need live acceptance testing.

The pilot uses `VALIDATION_PREVIEW`, which Amazon documents for testing a small number of listings with lower limits. Requests in a batch are sequential and spaced. A larger production synchronization service should use full schema validation and the JSON Listings Feed, with durable jobs and results, instead of scaling this preview loop.

A valid preview issues a 15-minute signed receipt bound to the actor, seller, marketplace, source variant, SKU, and complete attributes. Changes invalidate it. Live submission checks that the source is approved hardware, refuses an already-existing Amazon SKU, repeats validation, and then submits the unchanged payload. A review screen shows the SKUs, prices, and quantities before upload. There is no automatic retry of an ambiguous live submission.

`ACCEPTED` means submitted for processing. The separate status check reads asynchronous listing issues and buyability. After a network failure, check Amazon status or Seller Central before reopening the draft. Existing-SKU checks do not provide a distributed lock against another integration creating the same SKU concurrently; coordinate pilot uploads accordingly.

Drafts and results live in the current browser screen. Download them before leaving. Downloads are records, not a supported re-import format. Persistent draft storage and account-wide submission locking remain work for a production synchronization service.

## Verification and release

The reconciled isolated release passed 149 tests across 22 files, including uploader behavior, authenticator enrollment and password setup, authorization, password certification and reset invalidation, all required sales regressions, and the newer production review-workspace changes. ESLint and TypeScript checks passed. All 28 sales-preservation files match the trusted manifest. Production build and deployment outcomes are recorded in `amazon-security-release-verification.json`.

The real Shopify catalog query and authenticated Amazon sandbox smoke check passed separately. Production category acceptance and submission remain untested pending production authorization.

Follow `docs/release-preservation.md` for every later deployment. Preserve both the sales baseline and newer production source; do not deploy the dirty shared checkout.
