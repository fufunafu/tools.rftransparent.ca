<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Preserve published sales updates

- Never use em dashes.
- Before preparing any deployment, read `docs/release-preservation.md` and run `node scripts/verify-sales-preservation.mjs /absolute/path/to/release` from this checkout.
- The September 16 sales releases were deployed directly without a Git push. An older Git checkout, or even the current production source, can omit those previously published features. Neither is a sufficient baseline by itself.
- Preserve the five-period sales table, paired sales/quotes, searchable record details with customer names, and the Daniel/Aaron/Marie attribution rules. Preserve unrelated newer production changes as well.
- Do not discard untracked sales files, bypass the preservation check, regenerate its manifest merely to make a release pass, or roll back the entire application to recover one feature. Reconcile intentional changes and verify the regression tests first.
