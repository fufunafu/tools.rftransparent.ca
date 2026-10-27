import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { clientErrorReport } from '@/lib/client-error-reporting';
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (req.headers.get('origin') !== req.nextUrl.origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const raw = await req.text();
  if (raw.length > 4096) return NextResponse.json({ error: 'Report too large' }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'Invalid report' }, { status: 400 }); }
  if (!body || typeof body.path !== 'string' || !body.path.startsWith('/') || typeof body.message !== 'string' || typeof body.name !== 'string') return NextResponse.json({ error: 'Invalid report' }, { status: 400 });
  const { data, error } = await getSupabase().rpc('consume_lead_ingestion_rate_limit', {
    p_key: `client-error:${createHash('sha256').update(user.id).digest('hex')}`, p_limit: 10, p_window_seconds: 600,
  });
  const allowed = (Array.isArray(data) ? data[0] : data)?.allowed;
  if (error || !allowed) return new NextResponse(null, { status: error ? 503 : 429 });
  const report = clientErrorReport({ name: body.name, message: body.message, digest: typeof body.digest === 'string' ? body.digest : undefined }, body.path);
  console.error('[client-render-error]', JSON.stringify(report));
  return new NextResponse(null, { status: 204 });
}
