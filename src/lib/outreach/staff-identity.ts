import 'server-only';
import { getSupabase } from '@/lib/supabase';
import { quotePostgrestValue } from '@/lib/postgrest';

// Attribution always uses the authenticated email. Names are display-only,
// resolved from the employee directory rather than accepted from the client.
export async function outreachStaffIdentity(email: string) {
  const normalized = email.trim().toLowerCase();
  try {
    const result = await getSupabase().from('employees').select('name')
      .or(`email.eq.${quotePostgrestValue(normalized)},email_alt.eq.${quotePostgrestValue(normalized)}`)
      .eq('active', true).limit(1).maybeSingle();
    if (!result.error && result.data?.name) return { email: normalized, name: String(result.data.name).slice(0, 200) };
  } catch { /* The authenticated email remains a valid, unambiguous identity. */ }
  return { email: normalized, name: normalized };
}
