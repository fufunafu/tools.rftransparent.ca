import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { readLimitedJson } from '@/lib/outreach/http';
import { OutreachInputError } from '@/lib/outreach/domain';
import { outreachLeadStages } from '@/lib/outreach/staff-leads';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const update = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), stage: z.enum(outreachLeadStages),
  due: z.string().datetime({ offset: true }).nullable(), action: z.string().trim().max(1000),
  note: z.string().trim().max(4000), claim: z.boolean(),
}).refine(v => ['won','lost'].includes(v.stage) || Boolean(v.due && v.action.length >= 3));
export async function GET(request: Request) {
  if (!(await getAuthenticatedUser())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const db = getSupabase();
  if (id) {
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid lead' }, { status: 400, headers });
    const lead = await db.from('outreach_leads').select('contact_id,case_id').eq('id',id).maybeSingle();
    if (lead.error) return NextResponse.json({ error: 'Lead unavailable' }, { status: 503, headers });
    if (!lead.data) return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers });
    const campaign = await db.from('outreach_cases').select('campaign_key').eq('id',lead.data.case_id).single();
    if (campaign.error) return NextResponse.json({ error: 'Conversation unavailable' }, { status: 503, headers });
    const [events,audit,mail] = await Promise.all([
      db.from('outreach_events').select('id,event_type,occurred_at,event').eq('contact_id',lead.data.contact_id).eq('campaign_key',campaign.data.campaign_key).order('occurred_at',{ascending:false}).limit(50),
      db.from('outreach_audit').select('id,actor_email,action,detail,created_at').eq('contact_id',lead.data.contact_id).eq('detail->>leadId',id).order('created_at',{ascending:false}).limit(50),
      db.from('outreach_lead_mail').select('id,direction,received_at,subject,body').eq('lead_id',id).order('received_at',{ascending:false}).limit(100),
    ]);
    if (events.error || audit.error || mail.error) return NextResponse.json({ error: 'History unavailable' }, { status: 503, headers });
    return NextResponse.json({ events: events.data, audit: audit.data, mail: mail.data }, { headers });
  }
  const page = z.coerce.number().int().min(0).max(100000).safeParse(params.get('page') ?? 0);
  const stage = params.get('stage');
  if (!page.success || (stage && ![...outreachLeadStages,'suppressed'].includes(stage as never))) return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers });
  let query = db.from('outreach_leads').select('*,contact:outreach_contacts!inner(email,company_name),campaign:outreach_cases!inner(campaign_key)',{count:'exact'});
  if (stage) query=query.eq('stage',stage);
  if (params.get('due') === 'true') query=query.lte('next_follow_up_at',new Date().toISOString());
  const result = await query.order('next_follow_up_at',{ascending:true,nullsFirst:false}).order('id').range(page.data*50,page.data*50+49);
  if (result.error) return NextResponse.json({ error: 'Leads unavailable. Check connection and database setup.' }, { status: 503, headers });
  return NextResponse.json({ leads: result.data, total: result.count, page: page.data }, { headers });
}
export async function POST(request: Request) {
  const user=await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({error:'Unauthorized'},{status:401,headers});
  const origin=request.headers.get('origin');
  if (origin && origin!==new URL(request.url).origin) return NextResponse.json({error:'Origin not allowed'},{status:403,headers});
  try {
    const parsed=update.safeParse(await readLimitedJson(request,12000));
    if (!parsed.success) return NextResponse.json({error:'Choose a stage, next action and follow-up date.'},{status:400,headers});
    const v=parsed.data;
    const {error}=await getSupabase().rpc('outreach_lead_update',{p_id:v.id,p_version:v.version,p_actor:user.email,p_stage:v.stage,p_due:v.due,p_action:v.action,p_note:v.note,p_claim:v.claim});
    if (error) return NextResponse.json({error:'Lead changed or is no longer contactable. Refresh before saving.'},{status:409,headers});
    return NextResponse.json({saved:true},{headers});
  } catch(error) {
    return NextResponse.json({error:'Unable to save lead'},{status:error instanceof OutreachInputError?error.status:503,headers});
  }
}
