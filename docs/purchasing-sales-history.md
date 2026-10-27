# Purchasing sales history

The purchasing monthly figure is annual net units divided by 12, multiplied by the current month's configured seasonality. Annual units cover the 12 completed calendar months before the current month, including months with zero sales. October 2026 uses October 2025 through September 2026 and a 1.2 seasonal multiplier. The existing growth assumption is applied separately in stock projections.

RF (`store1`) and GRS (`store2`) order lines are retained in private database tables. `currentQuantity` deducts refunded and removed units. Test, cancelled, and voided orders do not contribute. Orders are grouped by `processedAt` in the store's timezone, with `createdAt` as a fallback. Refunds restate the original order month, so this is a product-demand history rather than a refund-date accounting report.

SKU matches consolidate recreated listings. Specific dimensions, mounting type, size, and finish can recover older SKU-less listings. Explicit specifications take precedence when a historical SKU conflicts, such as a black side-mount spigot labelled with the stainless SKU. Such matches are identified as estimates. Custom glass, holed panels, accessories, and products outside the purchasing catalog are not merged into ordinary panels or hardware. Ambiguous descriptions await staff review. Hinge kits count as kits; other unit conversions require review.

The Sales history page separates seasonal monthly demand, its annual-average basis, actual monthly units, estimated portions, and original listing descriptions. Management can approve a source mapping and unit multiplier or exclude a source. Every correction records its previous value and reviewer. Changes propagate to all retained history.

The five-minute `sync-purchasing-sales` job imports changes by `updatedAt`, with a five-minute overlap. Every order's line-item connection is fully paginated before saving. Complete orders replace their previous lines atomically. Cursor checkpoints allow continuation after interruption. A database lease prevents overlapping jobs. A snapshot publishes only after both stores have completed successfully within 30 minutes. Failed or incomplete imports retain the previous monthly baseline. Store permissions must include `read_all_orders`.

A local database rehearsal independently reconciled the store/product annual averages before the initial import. Existing manual baselines are saved in `purchasing_sales_original_baselines`; inventory, costs, purchase orders, and seasonality settings are not changed by the import. Deleted Shopify orders are not inferred from missing incremental results; administrative deletion reconciliation requires an explicit full-history audit.

Sources: [Shopify LineItem quantity semantics](https://shopify.dev/docs/api/admin-graphql/2026-01/objects/LineItem), [Shopify bulk query exports](https://shopify.dev/docs/api/admin-graphql/2026-01/mutations/bulkOperationRunQuery).
