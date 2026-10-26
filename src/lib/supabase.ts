import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { demoDataConfiguration, isDemoWorkspace } from "@/lib/review-data-config";

let _supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const demo = isDemoWorkspace() ? demoDataConfiguration() : null;
    const supabaseUrl = demo?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = demo?.key ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
      );
    }

    _supabase = createClient(supabaseUrl, supabaseServiceKey);
  }
  return _supabase;
}
