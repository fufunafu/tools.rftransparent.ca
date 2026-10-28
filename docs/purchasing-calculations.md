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

The stock coverage target after supplier arrival is:

- Glass: the higher of the configured capacity floor and demand during the
  configured cover period, capped at physical capacity.
- Hardware: demand during the next three calendar months, with a 50-unit minimum.

The supplier quantity protects lead-time demand plus this coverage target.
Confirmed shipments are counted on their dates, only within that coverage window.
An arrival outside the window cannot offset demand within it. The model checks
intermediate shortages as well as the final total. Bridge units are accounted for
separately, so they are not ordered again from the supplier.

This is an inventory-position target, including timely inbound supply. It is not
a claim that physical stock must equal that target on every date. The chart plots
physical stock and capacity; it does not draw the inventory-position threshold as
though it were a physical-stock trigger.

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
