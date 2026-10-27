import 'server-only';
import { getSupabase } from '@/lib/supabase';
import { INBOXES, readGmailConversation, extractEmail, type GmailConversationMessage } from '@/lib/gmail';
import { getJson, type EmailRecord } from './instantly';
import { explicitOptOut, authoredText, type OutreachEvent } from './domain';
import { GENERAL_INBOX } from './staff-leads';
export function staffMailDirection(message:GmailConversationMessage, prospect:string):'inbound'|'outbound'|null {
  const from=extractEmail(message.from);
  if (from===prospect) return 'inbound';
  const recipients=message.to.split(',').map(extractEmail);
  if (from===GENERAL_INBOX && recipients.includes(prospect)) return 'outbound';
  return null;
}
export async function syncOutreachStaffMail() {
  if (process.env.OUTREACH_MAIL_SYNC_ENABLED!=='true') return {skipped:'General inbox sync is disabled'};
  const db=getSupabase(), key=process.env.INSTANTLY_API_KEY;
  const inbox=INBOXES.find(i=>i.email===GENERAL_INBOX);
  if (!key || !inbox) throw new Error('General inbox sync is not configured');
  const {data:leads,error}=await db.from('outreach_leads').select('id,contact_id,case_id,interest_event_id')
    .not('stage','in','(won,lost,suppressed)').order('mail_synced_at',{ascending:true,nullsFirst:true}).limit(3);
  if(error)throw new Error('Lead mail queue unavailable');
  const summary={checked:0,synced:0,errors:0};
  for(const lead of leads??[]) {
    summary.checked++;
    try {
      const anchor=await db.from('outreach_events').select('event').eq('id',lead.interest_event_id).single();
      if(anchor.error || !anchor.data) throw new Error('Interest event unavailable');
      let event=anchor.data.event as OutreachEvent;
      if(!event.emailId){
        const reply=await db.from('outreach_events').select('event').eq('contact_id',lead.contact_id).eq('campaign_key',event.campaignKey)
          .eq('event_type','reply_received').lte('occurred_at',event.occurredAt).order('occurred_at',{ascending:false}).limit(1).maybeSingle();
        if(reply.error||!reply.data)throw new Error('Original reply needs review');
        event=reply.data.event as OutreachEvent;
      }
      if(!event.emailId)throw new Error('Original reply has no email reference');
      const email=await getJson(`emails/${encodeURIComponent(event.emailId)}`,key,fetch) as EmailRecord & {message_id?:string};
      if(email.id!==event.emailId || email.organization_id!==event.workspaceId || email.campaign_id!==event.campaignId
        || email.lead?.toLowerCase()!==event.email || email.ue_type!==2 || !email.message_id
        || (event.threadId && email.thread_id!==event.threadId)
        || (event.mailbox && email.eaccount?.toLowerCase()!==event.mailbox && email.eaccount?.toLowerCase()!==GENERAL_INBOX)) throw new Error('Original reply identity needs review');
      const messages=await readGmailConversation(inbox,email.message_id);
      messages.sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
      for(const message of messages){
        const direction=staffMailDirection(message,event.email);
        if(!direction)continue;
        const saved=await db.rpc('outreach_lead_receive_mail',{p_lead:lead.id,p_message:message.id,p_thread:message.threadId,p_direction:direction,
          p_at:message.receivedAt,p_body:authoredText(message.body)||'[Read the original email for HTML content or attachments.]',p_subject:message.subject.slice(0,2000),
          p_automatic:message.automatic,p_stop:direction==='inbound'&&!message.automatic&&explicitOptOut(message.body)});
        if(saved.error)throw new Error('Conversation could not be saved');
      }
      const saved=await db.from('outreach_leads').update({mail_synced_at:new Date().toISOString(),mail_sync_error:null}).eq('id',lead.id);
      if(saved.error)throw new Error('Sync status unavailable');summary.synced++;
    }catch{
      summary.errors++;
      const saved=await db.from('outreach_leads').update({mail_synced_at:new Date().toISOString(),mail_sync_error:'Inbox sync needs attention. Check the Gmail connection and original conversation.'}).eq('id',lead.id);
      if(saved.error)throw new Error('Sync failure could not be recorded');
    }
  }
  return summary;
}
