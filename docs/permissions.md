# Permissions

Authorization has three independent levels. A person may be an admin without being management, or management without being an admin.

| Level | Source | Typical capabilities |
| --- | --- | --- |
| Authenticated | Owner, allowed domain, active employee, or `admin_users` override | General operational dashboards and personal workflows |
| Admin | Owner, allowed domain, or `admin_users` override | Access management, account provisioning, administrative mutations |
| Management | Owner or active employee in the management department | Purchasing, reimbursement approval, and team-wide task oversight |

## Route expectations

| Area | View access | Elevated actions |
| --- | --- | --- |
| Home, sales, pipeline, marketing, Shopify | Authenticated | Route-specific API checks |
| Customer service | Authenticated | Admin checks for destructive or configuration actions |
| Warehouse dashboard and reports | Authenticated | Authenticated report writes |
| Purchasing | Management | Management for all purchasing reads and writes |
| Accounting and reimbursements | Authenticated | Management for approval and rejection |
| Tasks | Authenticated | Management for all-employee oversight |
| Employees | Authenticated | Admin for employee and password administration |
| Settings access list | Admin | Admin |
| Other settings and health | Authenticated | Admin where a form changes shared configuration |
| Weekly employee survey | Public capability link | Possession of the unguessable survey token |
| Lead webhooks | Public endpoint | Shopify App Proxy or provider signature, plus persistent rate limits |
| Cron endpoints | Public endpoint | Configured cron authorization secret |

Navigation filtering improves usability but is not a security control. Every sensitive page, route handler, and data operation must keep its own server-side authorization check.

When adding a route:

1. Add it to this matrix.
2. Add the server-side authorization check.
3. Add navigation access metadata if the destination is role-limited.
4. Add unit or browser coverage for allowed and denied roles.
