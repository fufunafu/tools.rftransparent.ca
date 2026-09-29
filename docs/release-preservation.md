# Preserve sales updates during releases

## Incident and scope

On September 29, 2026, the live `/dashboards/sales` page showed the older
three-person, 30-day leaderboard. The September 16 release receipts document
the newer five-period table and subsequent attribution and customer-name fixes.
The live deployment observed was `dpl_CqnrTMuE7omMnkFyPEw7eq1fowup`, created
September 26. The exact deployment that first removed the updates is not yet
established.

The September 16 receipts explicitly record `gitPush: false`. Several supporting
files remain untracked in this shared checkout. A successful build from Git or
from the current production source alone does not prove feature preservation.

`sales-preservation-baseline.json` records the local source preserved September
29. It is a recovery baseline, not a claim that this source is currently live or
that every shared-file change has been approved for deployment.

## Required release procedure

1. Record the current production deployment and retrieve its source into an
   isolated release directory. Inventory the published feature receipts as well
   as the current checkout. Do not deploy the entire dirty shared checkout.
2. Reconcile the intended feature changes with both current production and the
   preserved sales source. Retain unrelated production improvements, including
   later problem-ticket and native-app work. Never roll back the whole site just
   to recover sales functionality.
3. From the preserved checkout, check the actual candidate directory:

   ```sh
   node scripts/verify-sales-preservation.mjs /absolute/path/to/release
   ```

   This reads the trusted manifest beside the script, not one from the candidate.
   Missing or changed protected files stop the check. Intentional changes to
   shared files require a reviewed merge that retains the sales behavior; only
   then update the specific hashes with regression evidence. Do not blindly copy
   shared files over newer production changes or regenerate all hashes to pass.
4. Include the guard, manifest, documented rules, source, and regression tests in
   the release's version-controlled source. `npm run build` invokes the guard
   before Next.js. Ensure Vercel uses that command. Do not override it with a
   direct `next build` command or deploy an older checkout missing the guard.
5. Run the existing sales regression suites, lint, typecheck, and production
   build in the reconciled release. Inspect the complete staged diff and commit
   the reconciled release source so later Git deployments retain the updates.
6. After an authorized deployment, verify the live page in a fresh browser load:
   all five date columns, all five configured reps, paired sales/quotes, both
   total rows, and searchable record dialogs with customer names. Compare dialog
   totals to the selected table cells. Record the deployment ID and source hashes.

## Behavior to preserve

- Columns: 7 days, 30 days, 90 days, 180 days, and 1 year together.
- Net sales and quoted rows, all-rep totals, compact layout, optional details.
- Clickable amounts, searchable order/quote records, customer names, Shopify links.
- Daniel: RF orders and quotes in QC, NS, NB, and PE; territory takes priority.
- Aaron: RF records tagged Aaron or Aron, plus eligible RF BC records created July 16, 2026 onward. Daniel territory and Rob tags take priority. Tags qualify outside BC and before the territory start date; other conflicting rep tags are excluded.
- Marie: BC Transparent records carrying the exact normalized Marijac tag.
- Preserve authorization checks on the dashboard, record endpoint, and employee
  metrics. Preserve the distinction between dashboard transaction-based net sales
  and employee creation-date metrics.

Regression coverage includes `SalesTeamTable.test.tsx`,
`SalesRecordsTable.test.tsx`, `PerformersSection.test.tsx`,
`dashboard-sales.test.ts`, `dashboard-sales-records.test.ts`,
`ops-dashboard-sales.test.ts`, `sales-periods.test.ts`,
`sales-record-details.test.ts`, `EmployeeDetail.test.tsx`,
`src/app/api/dashboards/sales/records/route.test.ts`, and
`src/app/api/kpi/metrics/route.test.ts`.

## Limits

This check detects source drift, not whether every intentional change is correct.
On September 29, Vercel project `prj_twZOObjT1WQMMy7dQJCWQW6sM1am` was configured
to run `node scripts/verify-sales-preservation.mjs && npm run build`. An older
checkout lacking the guard will now fail its Vercel build. Do not remove or
override this project setting to make an old checkout deploy.

The restored source is saved in PR #9. Main requires independent review before
merge; do not bypass that protection. Until merged, future main builds missing
the guard are expected to fail and leave the active production deployment intact.
The guard alone does not restore the site; that requires a verified deployment.
The source recovery archive is listed in the baseline manifest and contains no
environment files or credentials.
