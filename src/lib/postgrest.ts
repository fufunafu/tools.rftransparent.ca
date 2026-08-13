// Helpers for safely embedding values in PostgREST filter strings.
//
// Supabase's `.or("email.eq.X,phone.eq.Y")` takes a filter *expression*, not
// parameterized values: `,` separates conditions and `()` group them, so a
// value interpolated raw can inject extra filter conditions. PostgREST's fix
// is double-quoting the value, with `"` and `\` escaped by backslash.

export function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Escape a value used with like/ilike so it only matches literally: `%` and
// `_` are SQL wildcards, and PostgREST additionally rewrites `*` to `%`.
// (A `\*` comes out the other side as a literal `%`, so a value containing
// `*` simply won't match — an acceptable miss, never an over-match.)
export function escapeIlikeValue(value: string): string {
  return value.replace(/[\\%_*]/g, (ch) => `\\${ch}`);
}
