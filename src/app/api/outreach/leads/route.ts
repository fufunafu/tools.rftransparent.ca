import { getAutomaticActivity, applyAutomaticActivity, automaticSummary } from '@/lib/outreach/automatic-activity';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { readLimitedJson } from '@/lib/outreach/http';
import { OutreachInputError } from '@/lib/outreach/domain';
import { outreachLeadStages } from '@/lib/outreach/staff-leads';
import { escapeIlikeValue, quotePostgrestValue } from '@/lib/postgrest';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const selection = '*,contact:outreach_contacts!inner(email,company_name),campaign:outreach_cases!inner(campaign_key)';
const update = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), stage: z.enum(outreachLeadStages),
  due: z.string().datetime({ offset: true }).nullable(), action: z.string().trim().max(1000),
  note: z.string().trim().max(4000), claim: z.boolean(),
  contactName: z.string().trim().max(200).optional(), phone: z.string().trim().max(60).optional(),
}).refine(v => (v.contactName===undefined)===(v.phone===undefined)).refine(v => ['won','lost'].includes(v.stage) || Boolean(v.due && v.action.length >= 3));
export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const db = getSupabase();
  if (id) {
    if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid lead' }, { status: 400, headers });
    const lead = await db.from('outreach_leads').select(selection).eq('id',id).maybeSingle();
    if (lead.error) return NextResponse.json({ error: 'Lead unavailable' }, { status: 503, headers });
    if (!lead.data) return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers });
    const [events,audit,mail,activity] = await Promise.all([
      db.from('outreach_events').select('id,event_type,occurred_at,event').eq('contact_id',lead.data.contact_id).eq('campaign_key',lead.data.campaign.campaign_key).order('occurred_at',{ascending:false}).limit(50),
      db.from('outreach_audit').select('id,actor_email,action,detail,created_at').eq('contact_id',lead.data.contact_id).eq('detail->>leadId',id).order('created_at',{ascending:false}).limit(50),
      db.from('outreach_lead_mail').select('id,direction,received_at,subject,body').eq('lead_id',id).order('received_at',{ascending:false}).limit(100),
      db.from('outreach_lead_activity').select('*').eq('lead_id',id).order('occurred_at',{ascending:false}).order('id').limit(100),
    ]);
    if (events.error || audit.error || mail.error || activity.error) return NextResponse.json({ error: 'History unavailable' }, { status: 503, headers });
    const automatic=await getAutomaticActivity().catch(()=>null);
    const automaticHistory=automatic?.history.get(id)||[];
    const enriched=automatic?applyAutomaticActivity(lead.data,automaticHistory):{...lead.data,activity_error:true};
    return NextResponse.json({ lead: enriched, events: events.data, audit: audit.data, mail: mail.data, activity: [...(activity.data||[]),...automaticHistory].sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)) }, { headers });
  }
  const filter = z.object({
    page: z.coerce.number().int().min(0).max(100000),
    stage: z.enum([...outreachLeadStages, 'suppressed', '']).default(''),
    campaign: z.enum(['materials_sales', 'installer_network', '']).default(''),
    owner: z.enum(['mine','unassigned','']).default(''),
    search: z.string().trim().max(200), due: z.enum(['true','false']),
  }).safeParse({page:params.get('page') ?? 0,stage:params.get('stage') ?? '',campaign:params.get('campaign') ?? '',
    owner:params.get('owner') ?? '',search:params.get('search') ?? '',due:params.get('due') ?? 'false'});
  if (!filter.success) return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers });
  const f = filter.data;
  const now = new Date().toISOString();
  let query = db.from('outreach_leads').select(selection,{count:'exact'});
  if (f.stage) query=query.eq('stage',f.stage);
  if (f.campaign) query=query.eq('campaign.campaign_key',f.campaign);
  if (f.owner === 'mine') query=query.eq('owner_email',user.email.toLowerCase());
  if (f.owner === 'unassigned') query=query.is('owner_email',null);
  if (f.due === 'true') query=query.not('stage','in','(won,lost,suppressed)').lte('next_follow_up_at',now);
  if (f.search) {
    const term = quotePostgrestValue(`%${escapeIlikeValue(f.search)}%`);
    query=query.or(`email.ilike.${term},company_name.ilike.${term}`,{referencedTable:'contact'});
  }
  const count = () => db.from('outreach_leads').select('id',{count:'exact',head:true});
  const [result,open,due,sync] = await Promise.all([
    query.order('next_follow_up_at',{ascending:true,nullsFirst:false}).order('id').range(f.page*50,f.page*50+49),
    count().not('stage','in','(won,lost,suppressed)'),
    count().not('stage','in','(won,lost,suppressed)').lte('next_follow_up_at',now),
    db.from('cron_runs').select('status,started_at').eq('job','process-outreach').order('started_at',{ascending:false}).limit(1).maybeSingle(),
  ]);
  if ([result,open,due].some(r=>r.error)) return NextResponse.json({ error: 'Leads unavailable. Check connection and database setup.' }, { status: 503, headers });
  const automatic=await getAutomaticActivity().catch(()=>null);
  const enriched=(result.data||[]).map(lead=>automatic?applyAutomaticActivity(lead,automatic.history.get(lead.id)||[]):{...lead,activity_error:true});
  return NextResponse.json({ leads: enriched, activityError:!automatic, total: result.count, page: f.page,
    summary:{open:open.count,needsCall:automatic?automaticSummary(automatic.leads).needsCall:null,quoted:automatic?automaticSummary(automatic.leads).quoted:null,due:due.count},
    sync:sync.error || !sync.data ? null : {status:sync.data.status,lastRunAt:sync.data.started_at},
    currentUser:user.email.toLowerCase(),
  }, { headers });
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
    const args={p_id:v.id,p_version:v.version,p_actor:user.email.toLowerCase(),p_stage:v.stage,p_due:v.due,p_action:v.action,p_note:v.note,p_claim:v.claim};
    // Preserve existing contact fields for older clients that do not send them.
    const result=v.contactName===undefined && v.phone===undefined
      ? await getSupabase().rpc('outreach_lead_update',args)
      : await getSupabase().rpc('outreach_lead_save',{...args,p_contact_name:v.contactName ?? '',p_phone:v.phone ?? ''});
    if (result.error) return NextResponse.json({error:'Lead changed or is no longer contactable. Refresh before saving.'},{status:409,headers});
    return NextResponse.json({saved:true},{headers});
  } catch(error) {
    return NextResponse.json({error:'Unable to save lead'},{status:error instanceof OutreachInputError?error.status:503,headers});
  }
}
