import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { normalizeInstantlyEvent, planOutreachEvent } from './domain';
let db:PGlite;
const config={workspaceId:'11111111-1111-4111-8111-111111111111',campaignIds:{installer_network:'22222222-2222-4222-8222-222222222222',materials_sales:'33333333-3333-4333-8333-333333333333'},webhookSecret:'x'.repeat(32)};
async function event(type='lead_interested',overrides:Record<string,unknown>={}){
 const e=normalizeInstantlyEvent({workspace:config.workspaceId,campaign_id:config.campaignIds.materials_sales,timestamp:'2026-10-23T12:00:00Z',event_type:type,lead_email:'fixture@example.com',email_id:`${type}-${Math.random()}`,reply_text:'Interested in a quote',...overrides},config)!;
 await db.query('select outreach_ingest($1::jsonb)',[JSON.stringify(e)]);
 const rows=(await db.query<{id:string;lease_token:string;event:typeof e}>('select * from outreach_claim(25)')).rows;
 for(const r of rows)await db.query('select outreach_apply($1,$2,$3::jsonb,$4::jsonb)',[r.id,r.lease_token,JSON.stringify(planOutreachEvent(r.event)),JSON.stringify(r.event)]);
}
async function lead(){return (await db.query<{id:string;version:number;stage:string;next_follow_up_at:string|null;owner_email:string|null}>('select * from outreach_leads')).rows[0];}
async function update(id:string,version:number,stage='contacted') {return db.query("select outreach_lead_update($1,$2,'employee@example.com',$3,'2026-10-27T12:00Z','Follow up on drawings','Discussed next project',true)",[id,version,stage]);}
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');for(const file of ['20260909210000_outreach_foundation.sql','20261023120000_outreach_staff_leads.sql'])await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('truncate outreach_contacts cascade');});
afterAll(async()=>{await db.close();});
describe('interested lead handoff',()=>{
 it('does not turn raw prospects or unclassified replies into tickets',async()=>{await event('email_sent');await event('reply_received');expect(await lead()).toBeUndefined();});
 it('creates one ticket on positive classification and pauses owned automation',async()=>{await event();await event();expect((await db.query('select * from outreach_leads')).rows).toHaveLength(1);expect((await db.query<{paused:boolean}>('select paused from outreach_contacts')).rows[0].paused).toBe(true);expect((await lead()).stage).toBe('new');});
 it('keeps installer and materials tickets independent',async()=>{await event();await event('lead_interested',{campaign_id:config.campaignIds.installer_network});expect((await db.query('select * from outreach_leads')).rows).toHaveLength(2);});
 it('creates a ticket when staff already owns the contact',async()=>{await event('reply_received');await db.exec('update outreach_contacts set paused=true');await event();expect(await lead()).toBeDefined();});
 it('assigns ownership, records a follow-up, and rejects stale staff edits',async()=>{await event();const l=await lead();await update(l.id,l.version);expect((await lead()).owner_email).toBe('employee@example.com');expect((await lead()).stage).toBe('contacted');await expect(update(l.id,l.version)).rejects.toThrow('Lead changed');expect((await db.query("select * from outreach_audit where action='lead_updated'")).rows).toHaveLength(1);});
 it('makes a new reply due now while staff handles it',async()=>{await event();let l=await lead();await update(l.id,l.version);await event('reply_received',{timestamp:'2026-10-24T12:00:00Z'});l=await lead();expect(l.version).toBe(3);expect(l.stage).toBe('contacted');expect(Date.parse(l.next_follow_up_at!)).toBeLessThanOrEqual(Date.now()+1000);});
 it('does not reopen closed tickets on repeated interest',async()=>{await event();const l=await lead();await update(l.id,l.version,'won');await event('lead_interested',{timestamp:'2026-10-24T12:00:00Z'});expect((await lead()).stage).toBe('won');expect((await lead()).next_follow_up_at).toBeNull();});
 it('cancels follow-ups immediately on an opt-out and rejects further staff edits',async()=>{await event();const l=await lead();await event('lead_unsubscribed');expect((await lead()).stage).toBe('suppressed');expect((await lead()).next_follow_up_at).toBeNull();await expect(update(l.id,(await lead()).version)).rejects.toThrow('suppressed');});
 it('does not create a ticket from stale positive events after a decline',async()=>{await event('lead_not_interested',{timestamp:'2026-10-24T12:00:00Z'});await event();expect(await lead()).toBeUndefined();});
 it('requires a next action and date for active leads',async()=>{await event();const l=await lead();await expect(db.query("select outreach_lead_update($1,1,'employee@example.com','follow_up',null,'','','false')",[l.id])).rejects.toThrow('Next action');});
 it('cancels follow-ups when a later reply is classified as declined',async()=>{await event();await event('lead_not_interested',{timestamp:'2026-10-24T12:00:00Z'});expect((await lead()).stage).toBe('lost');expect((await lead()).next_follow_up_at).toBeNull();});
 it('saves exact-thread staff mail once and preserves a scheduled follow-up',async()=>{await event();const l=await lead();await update(l.id,l.version);const before=await lead();const at=new Date(Date.now()+1000).toISOString();for(let i=0;i<2;i++)await db.query("select outreach_lead_receive_mail($1,'msg1','thread1','outbound',$2,'Here is the quote','Re: project',false,false)",[l.id,at]);expect((await db.query('select * from outreach_lead_mail')).rows).toHaveLength(1);expect((await lead()).version).toBe(before.version+1);expect((await lead()).next_follow_up_at).toEqual(before.next_follow_up_at);});
 it('honors an opt-out found in Gmail before another webhook arrives',async()=>{await event();const l=await lead();await db.query("select outreach_lead_receive_mail($1,'stop1','thread1','inbound',now(),'Stop emailing me','Re: project',false,true)",[l.id]);expect((await lead()).stage).toBe('suppressed');expect((await lead()).next_follow_up_at).toBeNull();});
 it('denies direct public access',async()=>{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(db.query('select * from outreach_leads')).rejects.toThrow('permission denied');await db.exec('reset role');}});
});
