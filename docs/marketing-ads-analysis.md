# Google Ads vs Shopify Analysis - Glass Railing Store (Jul-Aug 2026)

Reference doc from the July 2026 ads analysis done with Claude Code. Data sources are this repo's own credentials (`.env.local`: `GOOGLE_ADS_*`, `SHOPIFY_STORE_2` = Glass Railing Store). Both accounts bill in CAD.

## The core finding

**Google Ads conversion tracking is structurally broken for GRS and cannot be used to judge campaigns.** Most sales close through a rep-built quote (form/phone → quote → payment via draft-order invoice), often weeks after the ad click, so Google never ties the purchase back to the ad. Measured over 90 days (Apr 18 – Jul 16, 2026):

- Store grew +15% month-over-month while Google-reported ad revenue fell 24%, a measurement artifact rather than a business problem.
- Florida: $100,402 actual Shopify sales (15 orders) on $3,127 ad spend across 4 campaigns = **32× real blended ROAS**, while the Florida-named campaign alone showed 0.08 ROAS in Google. Google saw only ~23% of FL revenue.
- Washington: $64k actual sales, $2 Google-reported.

**Rule adopted: judge every campaign/state on Shopify revenue ÷ Google spend ("your ROAS"), never Google-reported ROAS.** Per-state spend comes from Google's `geographic_view` (location-of-presence), which we verified sums ALL campaigns serving a state (national + state-specific) and captures ~95% of account spend.

## Key numbers (as of 2026-07-17 snapshot)

- All-time (~2 yrs): ~$6.3M store revenue on ~$328k Google spend. US $3.7M/$213k, CA $2.6M/$112k.
- US vs Canada blended ROAS flips by window: 6mo US 17.3× vs CA 13.6×, but 1yr CA 19.2× vs US 17.3× (Canada winter drags short windows, so seasonality matters).
- FL/CA/NY are the only US states with real order volume (15–26 orders/window). MO/TN/WA/OR revenue is whale-driven (4–7 orders at $9–13k AOV = contractor projects).
- Ad cost per Shopify order ≈ $220 (~6% of revenue).

## Strategy agreed with Sultan (ads specialist)

1. Shopify sales = primary KPI.
2. Dedup overlapping campaigns (up to 16 could serve one FL shopper); brand exclusions on PMax; exclude dedicated-campaign states from national.
3. NO new single-state campaigns (~2 orders/mo starves Smart Bidding). Instead ONE pooled **"High-Value States"** PMax campaign: WA + NC + MO + TN + OR + CT + NJ, excluded from national. Launched ~Jul 31, 2026 (verify it's one campaign, not several).
4. Florida is NOT to be cut (its bad Google ROAS is a tracking artifact).
5. Budget-lift tests must run test + control state baskets simultaneously (seasonality-proof); see test-plan artifact.

## Open items (as of 2026-08-10)

- **Elevar** ($225/mo, server-side + Enhanced Conversions): accept only after Sultan confirms how a quote sale closing weeks later is attributed (needs Enhanced Conversions for Leads / offline conversion import keyed on email/gclid, not just checkout tracking). Alternative: build the offline-conversion feed in this repo (Shopify + Google Ads API already wired in `src/lib/`).
- **August budget**: Sultan proposed $32k at 70/30 US/CA (halves Canada mid-peak-season). Counter-proposal: 60/40 for August, 70/30 from October.
- **KPI targets**: break-even ROAS = 1 ÷ gross margin (owner to supply margin); scale target ≈ 2× break-even; only meaningful after 4–6 weeks of clean Elevar data.

## Artifacts & tooling

- Interactive dashboard (period toggle, all states w/ orders + AOV + spend + ROAS): https://claude.ai/code/artifact/26b9e284-fa82-4b83-9502-a235e8e99777
- Simple budget-lift test plan: https://claude.ai/code/artifact/4ef7f02f-3e35-4e5e-a860-06ad408534c5
- Local self-contained copies: `~/Documents/ONLINE STORE/3-Marketing_Ads/ANALYSIS-07-2026/*.html` (dashboard embeds all data in a `const ROOT = {...}` blob and is recomputable without API pulls).
- Data pipeline: GAQL pulls mirror `src/lib/google-ads.ts` (campaign daily + `geographic_view` spend); Shopify orders via Admin GraphQL (`SHOPIFY_STORE_2`, orders by `processedAt` + shipping province). Rebuild note: pre-aggregate period views (~30–50KB) before embedding in HTML; raw daily rows (~580KB) fail to render as a Claude artifact.
