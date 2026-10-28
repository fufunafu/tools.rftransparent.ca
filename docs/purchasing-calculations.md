# Purchasing calculation rules

`src/lib/purchasing/planning.ts` is the application calculation source. Inventory,
order planning, excess-stock clearance, and the forecast all use its output from
one request snapshot. The historical SQL reorder view is no longer used for
application planning decisions.

## Sales baseline and demand

- The baseline is net units from the last 12 completed calendar months, divided
  by 12. Months with zero sales remain in the denominator.
- RF and GRS are combined after historical listings are matched to purchasing
  products. Ambiguous matches remain excluded pending review.
- Displayed monthly demand is baseline times that calendar month's seasonality.
- Forecast demand additionally applies the configured growth percentage, once.
  Each month's projected units are divided by that month's actual day count.
  A full year of flat seasonality therefore consumes exactly 12 monthly totals.
- Purchasing dates use America/Toronto. A valid zero growth factor means zero
  forecast demand, rather than falling back to normal demand.

## Dated supply and recommendations

Only the remaining quantity of ordered or in-transit purchase orders is inbound.
The forecast adds each shipment at the start of its ETA date. Overdue and undated
shipments remain visible as inbound, but are flagged and excluded from dated
planning until their ETA is confirmed. They are not assumed to arrive today.

A supplier order placed today can arrive after the configured lead time. The
Montreal bridge is the maximum cumulative shortage before that date, accounting
for every confirmed shipment in that interval. A small early delivery cannot hide
another shortage before supplier replenishment is possible.

Glass uses an editable order interval independent of supplier lead time, initially
30 days. The post-arrival target is seasonal demand over that interval plus a
safety allowance: 21 days for fast sellers (at least 365 annual panels), 14 for
regular sellers (12 to 364), and 7 for slow sellers (fewer than 12). Slow sellers
with positive forecast demand have an editable 2-unit minimum. These are initial
operating allowances, not calibrated service-level probabilities. Zero sales or
a disabled demand forecast does not create an automatic glass minimum.

Capacity is a storage constraint, never a purchasing floor or a cap on calculated
demand. The rounded order is replayed with dated supply and any projected capacity
excess requires review. Slow-selling glass crate purchases, unresolved shortages,
and unconfirmed inbound dates also require review. Bulk fill skips these rows;
users can deliberately choose a quantity after reviewing the warning.

China lead time starts at 84 days. The delay scenario adds 21 days, giving 105 days
with the initial settings. It reports uncovered demand if the new order is delayed;
existing dated POs keep their ETAs. This is a scenario, not a delivery guarantee.

Hardware retains its existing target: three calendar months of demand after
supplier arrival, with a 50-unit minimum.

The glass supplier requirement retains all forecast demand through lead time and
the coverage target until supply is confirmed. A suggested Montreal transfer is
not supply. Only an ordered or in-transit shipment with a usable ETA reduces the
requirement. Pre-arrival shortages cannot be fixed by a new China order; resolve
those separately and recalculate after confirming a transfer. Do not submit both
recommendation lists unchanged. This conservatively retains unresolved demand for
purchasing, while the physical chart continues to clamp depleted stock at zero
and does not invent a confirmed customer backlog.

Later supply cannot hide an earlier shortage. All supply arriving on the new
order's ETA is applied before that day's demand. The model checks intermediate
gaps before subsequent arrivals and the final requirement. Neither total inbound
nor an unconfirmed bridge can silently offset the required quantity.

The inventory-position target is not a claim that physical stock must equal it
on every date. The chart plots recorded physical stock and dated confirmed supply;
it does not include suggested orders, hypothetical transfers, or safety allowances
as actual stock.

Supplier quantities round up to whole crates, or one half-crate when that covers
the complete requirement. Rounding never drops below the required quantity.
Hardware and transfer quantities round up to whole units.

## Interpretation and limits

Projected stockout uses the same daily demand and ETA schedule as recommendations.
The chart assumes unmet demand after stockout is lost, not accumulated as an
unrecorded backlog. A later shipment therefore adds its full remaining quantity.
The graph places each depletion at its calculated time within the day and keeps
zero-stock intervals flat, including repeated stockouts after partial deliveries.
No stockout within the one-year chart horizon is shown as unknown beyond that
horizon, not infinite stock coverage.

Sales represent net ordered units, including accepted orders awaiting payment.
They are not cash receipts. Refunds and removed line quantities are excluded by
Shopify's current quantity; test, cancelled, and voided orders are excluded.

Stock counts, delivery dates, historical matching decisions, seasonality, and
forecast growth remain inputs requiring operational review. Arithmetic checks do
not verify a physical warehouse count or guarantee a delivery date.
