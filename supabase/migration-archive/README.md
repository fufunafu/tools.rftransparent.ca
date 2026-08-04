# Archived migrations

These SQL files were applied to production manually, but reused a migration
version that already existed in `supabase/migrations`. Supabase tracks only the
numeric version, so leaving both files in the active directory makes every
future `supabase db push` try to replay the second file.

The files remain here as immutable schema history. Do not move them back into
the active migration directory. New migrations must use a unique version.
