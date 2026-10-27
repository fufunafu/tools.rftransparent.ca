import { getSupabase } from '@/lib/supabase';
import { deduplicateRecords, sanitizePhone } from '@/lib/call-metrics';
import { matchPhoneCallsToLeads, type PhoneCallForLeadSync } from '@/lib/lead-call-sync';
import { matchDraftOrdersToLeads, type DraftForLeadQuoteSync } from '@/lib/lead-quote-sync';
import { getStores } from '@/lib/shopify';
import { leadIsClosed, type StaffLead, type LeadActivity } from './staff-leads';

const email = (value: string | null) => value?.trim().toLowerCase() || '';
const time = (value: string | null) => value ? Date.parse(value) : 0;
export type ActivityDraft = DraftForLeadQuoteSync & { last_invoice_sent_at?: string | null };
export type ActivityLead = StaffLead & { interested_at?: string };
export function deriveAutomaticActivity(leads: ActivityLead[], calls: PhoneCallForLeadSync[], drafts: ActivityDraft[]) {
  const history = new Map<string, LeadActivity[]>();
  const inputs = leads.map(lead => ({id:lead.id,email:lead.contact.email,phone:lead.phone,
    submitted_at:lead.interested_at || lead.created_at,quote_number:null,outcome:'new' as const,
    assigned_to:null,not_applicable_reason:null,call_status:'not_called' as const}));
  for (const match of matchPhoneCallsToLeads(inputs, deduplicateRecords([...new Map(calls.map(call=>[call.id,call])).values()]) as PhoneCallForLeadSync[])) {
    history.set(match.leadId,match.attempts.map(a=>({id:`phone:${a.id}`,lead_id:match.leadId,kind:'call',
      actor_email:'',actor_name:a.staff,occurred_at:a.called_at,created_at:a.called_at,note:`Phone system: ${a.notes}`,
      call_result:a.result==='No answer'?'no_answer':'connected',quote_number:null,quote_amount:null,quote_currency:null,quote_url:null})));
  }
  for (const draft of drafts) {
    // A conflicting email must never be overridden by a shared business phone.
    const candidates = inputs.filter(lead => {
      if (email(draft.customer_email)) return email(lead.email)===email(draft.customer_email);
      const phone = sanitizePhone(draft.customer_phone);
      return phone && phone.length>=10 && sanitizePhone(lead.phone)===phone;
    });
    if (!email(draft.customer_email) && new Set(candidates.map(l=>email(l.email))).size>1) continue;
    for (const match of matchDraftOrdersToLeads(candidates,[{...draft,shopify_created_at:draft.last_invoice_sent_at || draft.shopify_created_at}])) {
      const host=getStores().find(s=>s.id==='store2')?.store;
      const draftId=match.draftId.split('/').pop();
      const url=host && /^[\w.-]+\.myshopify\.com$/.test(host) && /^\d+$/.test(draftId||'') ? `https://${host}/admin/draft_orders/${draftId}` : null;
      const activity:LeadActivity={id:`shopify:${match.draftId}`,lead_id:match.leadId,kind:'quote',actor_email:'',
        actor_name:match.responsibleStaff || 'Staff not recorded',occurred_at:match.quoteSentAt,created_at:match.quoteSentAt,
        note:draft.last_invoice_sent_at?'Shopify sent quote. Date is the latest invoice send time.':'Shopify sent quote. Send time unavailable; showing draft creation date.',call_result:null,
        quote_date_kind:draft.last_invoice_sent_at?'sent':'created',
        quote_number:match.quoteNumber,quote_amount:match.quoteAmount,quote_currency:null,quote_url:url};
      history.set(match.leadId,[...(history.get(match.leadId)||[]),activity]);
    }
  }
  return history;
}
export function applyAutomaticActivity(lead: StaffLead, history: LeadActivity[]): StaffLead {
  const result={...lead};
  const calls=history.filter(a=>a.kind==='call').sort((a,b)=>time(b.occurred_at)-time(a.occurred_at));
  const quote=history.filter(a=>a.kind==='quote').sort((a,b)=>time(b.occurred_at)-time(a.occurred_at))[0];
  const call=calls[0];
  if(call && time(call.occurred_at)>=time(lead.last_call_at)) Object.assign(result,{
    last_call_at:call.occurred_at,last_called_by:null,last_called_by_name:call.actor_name,last_call_result:call.call_result,call_source:'automatic',
  });
  // Manual entries can describe the same call, so do not add the counts together.
  result.call_count=Math.max(lead.call_count||0,calls.length);
  if(quote && time(quote.occurred_at)>=time(lead.quote_sent_at)) Object.assign(result,{
    quote_sent_at:quote.occurred_at,quote_number:quote.quote_number,quote_amount:quote.quote_amount,
    quote_currency:quote.quote_currency,quote_url:quote.quote_url,quote_date_kind:quote.quote_date_kind,quoted_by:null,quoted_by_name:quote.actor_name,quote_source:'automatic',
  });
  return result;
}
async function all<T>(page:(from:number,to:number)=>PromiseLike<{data:T[]|null;error:unknown}>) {
  const rows:T[]=[];
  for(let from=0;from<100000;from+=1000){
    const result=await page(from,from+999);
    if(result.error) throw new Error('Automatic activity unavailable');
    rows.push(...(result.data||[]));
    if(!result.data || result.data.length<1000)return rows;
  }
  throw new Error('Activity result exceeds safe read limit');
}
let cached: {at:number;value:Awaited<ReturnType<typeof readActivity>>}|undefined;
let pending:ReturnType<typeof readActivity>|undefined;
async function readActivity(){
  const db=getSupabase();
  const leads=await all<ActivityLead>((from,to)=>db.from('outreach_leads').select('*,contact:outreach_contacts!inner(email,company_name),campaign:outreach_cases!inner(campaign_key)').order('id').range(from,to));
  if(!leads.length)return {leads,history:new Map<string,LeadActivity[]>()};
  const ids=leads.map(l=>l.interest_event_id).filter(Boolean);
  for(let i=0;i<ids.length;i+=100){
    const result=await db.from('outreach_events').select('id,occurred_at').in('id',ids.slice(i,i+100));
    if(result.error)throw new Error('Interest dates unavailable');
    const dates=new Map((result.data||[]).map(e=>[e.id,e.occurred_at]));
    for(const lead of leads)if(dates.has(lead.interest_event_id))lead.interested_at=dates.get(lead.interest_event_id);
  }
  const since=new Date(Math.min(...leads.map(l=>time(l.interested_at||l.created_at)))).toISOString();
  const [calls,drafts]=await Promise.all([
    all<PhoneCallForLeadSync>((from,to)=>db.from('call_records').select('id,store_id,call_start,call_end,from_number,to_number,direction,duration_min,charge,endpoint,source').gte('call_start',since).order('call_start').order('id').range(from,to)),
    all<ActivityDraft>((from,to)=>db.from('followup_leads').select('shopify_draft_id,draft_name,customer_email,customer_phone,quote_amount,shopify_created_at,shopify_status,first_synced_at,last_invoice_sender,created_by_staff,last_invoice_sent_at').eq('store_id','store2').in('shopify_status',['INVOICE_SENT','COMPLETED']).or(`last_invoice_sent_at.gte.${since},shopify_created_at.gte.${since},first_synced_at.gte.${since}`).order('id').range(from,to)),
  ]);
  const history=deriveAutomaticActivity(leads,calls,drafts);
  return {leads:leads.map(l=>applyAutomaticActivity(l,history.get(l.id)||[])),history};
}
export async function getAutomaticActivity(){
  if(cached && Date.now()-cached.at<60000)return cached.value;
  if(!pending)pending=readActivity().then(value=>{cached={at:Date.now(),value};return value;}).finally(()=>{pending=undefined;});
  return pending;
}
export function automaticSummary(leads:StaffLead[]){
  return {needsCall:leads.filter(l=>!leadIsClosed(l.stage)&&!l.last_call_at).length,quoted:leads.filter(l=>l.stage!=='suppressed'&&l.quote_sent_at).length};
}
