# Database migration policy

The repository contains historical migrations with duplicate numeric prefixes:

- `008`
- `009`
- `024`
- `025`
- `054`

These files may already be recorded in production migration history. Do not rename or reorder them without first comparing the local directory with the migration records in every deployed Supabase environment.

## New migrations

Use a unique UTC timestamp prefix:

```text
YYYYMMDDHHMMSS_short_description.sql
```

Example:

```text
20260729194500_add_ticket_priority.sql
```

## Deployment procedure

1. Back up the target database.
2. Compare local and remote migration history.
3. Review the SQL for locks, data rewrites, and rollback requirements.
4. Test against a recent non-production copy.
5. Apply the migration once.
6. Verify the affected tables, indexes, policies, and application workflow.
7. Record any manual recovery procedure in the pull request and operational notes.

Never edit an applied migration to change production behavior. Add a new corrective migration instead.
