import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeInstantlyEvent, planOutreachEvent } from './domain';
let db:PGlite;
const config={workspaceId:'11111111-1111-4111-8111-111111111111',campaignIds:{installer_network:'22222222-2222-4222-8222-222222222222',materials_sales:'33333333-3333-4333-8333-333333333333'},webhookSecret:'x'.repeat(32)};
interface LeadRow {id:string;version:number;stage:string;call_count:number;last_called_by:string;last_called_by_name:string;last_call_result:string;last_call_at:string;quoted_by:string;quoted_by_name:string;quote_number:string;quote_amount:string;quote_currency:string;owner_email:string;next_action:string;phone:string;contact_name:string}
async function lead(){return (await db.query<LeadRow>('select * from outreach_leads')).rows[0];}
async function seed(){
 const e=normalizeInstantlyEvent({workspace:config.workspaceId,campaign_id:config.campaignIds.materials_sales,timestamp:'2026-10-23T12:00:00Z',event_type:'lead_interested',lead_email:'fixture@example.com',email_id:randomUUID(),reply_text:'Interested in a quote'},config)!;
 await db.query('select outreach_ingest($1::jsonb)',[JSON.stringify(e)]);
 const rows=(await db.query<{id:string;lease_token:string;event:typeof e}>('select * from outreach_claim(25)')).rows;
 for(const r of rows)await db.query('select outreach_apply($1,$2,$3::jsonb,$4::jsonb)',[r.id,r.lease_token,JSON.stringify(planOutreachEvent(r.event)),JSON.stringify(r.event)]);
}
interface ActivityInput {id?:string;version?:number;request?:string;actor?:string;name?:string;kind?:string;at?:string;note?:string;result?:string|null;reference?:string|null;amount?:number|null;currency?:string|null;url?:string|null;due?:string|null;action?:string|null}
async function record(v:ActivityInput={}){
 const l=await lead(),kind=v.kind??'call';
 return db.query('select outreach_lead_log_activity($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[
  v.id??l.id,v.version??l.version,v.request??randomUUID(),v.actor??'staff@example.com',v.name??'Alex Team',kind,v.at??'2026-10-24T12:00:00Z',v.note??'Discussed the project',
  v.result===undefined?(kind==='call'?'connected':null):v.result,v.reference===undefined?(kind==='quote'?'GRS-1042':null):v.reference,
  v.amount===undefined?(kind==='quote'?1234.56:null):v.amount,v.currency===undefined?(kind==='quote'?'USD':null):v.currency,v.url??null,
  v.due===undefined?(kind==='note'?null:'2026-10-28T12:00:00Z'):v.due,v.action===undefined?(kind==='note'?null:'Follow up on drawings'):v.action,
 ]);
}
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');for(const file of ['20260909210000_outreach_foundation.sql','20261023120000_outreach_staff_leads.sql','20261027020000_outreach_lead_activity.sql'])await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('truncate outreach_contacts cascade');await seed();});
afterAll(async()=>{await db.close();});
describe('outreach call and quote records',()=>{
 it('records the caller and outcome, claims unassigned work and schedules the next step atomically',async()=>{
  await record();expect(await lead()).toMatchObject({stage:'contacted',call_count:1,last_called_by:'staff@example.com',last_called_by_name:'Alex Team',last_call_result:'connected',owner_email:'staff@example.com',version:2,next_action:'Follow up on drawings'});
  expect((await db.query('select * from outreach_lead_activity')).rows).toHaveLength(1);
 });
 it('counts unanswered attempts without marking the client as contacted',async()=>{await record({result:'no_answer'});expect(await lead()).toMatchObject({stage:'new',call_count:1,last_call_result:'no_answer'});});
 it('records quote attribution separately from caller attribution and keeps both records',async()=>{
  await record();await record({kind:'quote',actor:'quote@example.com',name:'Jamie Quotes'});
  expect(await lead()).toMatchObject({stage:'quote_sent',quoted_by:'quote@example.com',quoted_by_name:'Jamie Quotes',quote_number:'GRS-1042',quote_amount:'1234.56',quote_currency:'USD',last_called_by:'staff@example.com',owner_email:'staff@example.com'});
  expect((await db.query('select * from outreach_lead_activity')).rows).toHaveLength(2);
 });
 it('retries an identical request without double counting or rejecting the now-stale version',async()=>{
  const request=randomUUID();await record({request,version:1});await record({request,version:1});expect(await lead()).toMatchObject({call_count:1,version:2});
  await expect(record({request,version:1,note:'Different outcome'})).rejects.toThrow('already used');
 });
 it('rejects stale changes without partial activity inserts',async()=>{await record();await expect(record({version:1,kind:'quote'})).rejects.toThrow('Lead changed');expect((await db.query('select * from outreach_lead_activity')).rows).toHaveLength(1);});
 it('keeps the most recent call and quote summaries when an older activity is backfilled',async()=>{
  await record({at:'2026-10-25T12:00:00Z'});await record({actor:'older@example.com',result:'voicemail',at:'2026-10-24T12:00:00Z'});
  expect(await lead()).toMatchObject({call_count:2,last_called_by:'staff@example.com',last_call_result:'connected'});
  await record({kind:'quote',reference:'NEW',at:'2026-10-25T12:00:00Z'});await record({kind:'quote',reference:'OLD',at:'2026-10-24T12:00:00Z'});expect((await lead()).quote_number).toBe('NEW');
 });
 it('does not reopen closed leads when adding a note',async()=>{await db.exec("update outreach_leads set stage='won',next_follow_up_at=null");await record({kind:'note'});expect((await lead()).stage).toBe('won');await expect(record()).rejects.toThrow('Reopen');});
 it('blocks activities after opt-out',async()=>{await db.exec("update outreach_contacts set suppressed_at=now()");await expect(record()).rejects.toThrow('suppressed');await expect(record({kind:'note'})).rejects.toThrow('suppressed');expect((await db.query('select * from outreach_lead_activity')).rows).toHaveLength(0);});
 it('requires an outcome, quote reference and follow-up rather than recording incomplete work',async()=>{
  await expect(record({result:null})).rejects.toThrow('Call result');await expect(record({due:null})).rejects.toThrow('Next action');await expect(record({kind:'quote',reference:''})).rejects.toThrow('Invalid quote');await expect(record({kind:'quote',amount:-1})).rejects.toThrow('Invalid quote');await expect(record({kind:'quote',url:'javascript:alert(1)'})).rejects.toThrow('Invalid quote');expect((await lead()).version).toBe(1);
 });
 it('saves contact details with the original version and suppression protections',async()=>{
  const l=await lead();await db.query("select outreach_lead_save($1,1,'staff@example.com','qualifying','2026-10-28','Call the client','Project notes',true,'Jordan','+1 555 010 0100')",[l.id]);
  expect(await lead()).toMatchObject({version:2,phone:'+1 555 010 0100',contact_name:'Jordan',stage:'qualifying'});
  await expect(db.query("select outreach_lead_save($1,1,'staff@example.com','new','2026-10-28','Call client','',false,'','')",[l.id])).rejects.toThrow('Lead changed');
 });
 it('imports missing contact details without overwriting staff edits or accepting another campaign',async()=>{
  const l=await lead();
  await db.query('select outreach_lead_sync_profile($1,$2,$3,$4,$5,$6)',[l.id,'fixture@example.com',config.campaignIds.materials_sales,'Example Builder','Source Name','111']);
  expect(await lead()).toMatchObject({phone:'111',contact_name:'Source Name',version:2});
  await db.exec("update outreach_leads set phone='Staff correction'");
  await db.query('select outreach_lead_sync_profile($1,$2,$3,$4,$5,$6)',[l.id,'fixture@example.com',config.campaignIds.materials_sales,'Changed company','Other name','222']);
  expect(await lead()).toMatchObject({phone:'Staff correction',contact_name:'Source Name',version:2});
  await expect(db.query('select outreach_lead_sync_profile($1,$2,$3,$4,$5,$6)',[l.id,'fixture@example.com',config.campaignIds.installer_network,'Wrong','',''])).rejects.toThrow('Profile identity mismatch');
 });
 it('denies direct activity access and execution to public browser roles',async()=>{for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(db.query('select * from outreach_lead_activity')).rejects.toThrow('permission denied');await expect(db.query("select outreach_lead_log_activity(null,1,null,'x','x','note',now(),'x',null,null,null,null,null,null,null)")).rejects.toThrow('permission denied');await db.exec('reset role');}});
});
