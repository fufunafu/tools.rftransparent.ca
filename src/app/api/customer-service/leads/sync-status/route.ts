import { NextResponse } from 'next/server';
import { isAuthenticated, isAdminUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { getAutomationDetailFailure } from '@/lib/automation-status';
export const dynamic = 'force-dynamic';
const SOURCES = [
  { job: 'process-outreach', label: 'Outreach', staleMinutes: 20 },
  { job: 'sync-calls', label: 'Calls', staleMinutes: 120 },
  { job: 'sync-lead-quotes', label: 'Quote matching', staleMinutes: 120 },
  { job: 'sync-followup', label: 'Shopify import', staleMinutes: 1560 },
];
export async function GET() {
  if (!(await isAuthenticated())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getSupabase();
  const sources = await Promise.all(SOURCES.map(async ({ job, label, staleMinutes }) => {
    const { data, error } = await db.from('cron_runs').select('status,started_at,detail').eq('job', job).order('started_at', { ascending: false }).limit(50);
    const success = data?.find((run) => run.status === 'success' && !getAutomationDetailFailure(run.detail));
    const latest = data?.[0];
    const lastSuccessAt = success?.started_at ?? null;
    const failed = latest?.status === 'error' || Boolean(getAutomationDetailFailure(latest?.detail));
    return { job, label, lastSuccessAt, needsAttention: Boolean(error || failed || !lastSuccessAt || Date.now() - Date.parse(lastSuccessAt) > staleMinutes * 60_000),
      error: error ? 'Sync history unavailable' : failed ? 'Latest update did not complete successfully' : null };
  }));
  return NextResponse.json({ canSync: await isAdminUser(), sources });
}
