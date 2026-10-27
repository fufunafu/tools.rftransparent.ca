import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
import {normalizeInstantlyEvent,planOutreachEvent,type OutreachEvent} from './domain';
let db:PGlite;
const config={workspaceId:'11111111-1111-4111-8111-111111111111',campaignIds:{installer_network:'22222222-2222-4222-8222-222222222222',materials_sales:'33333333-3333-4333-8333-333333333333'},webhookSecret:'x'.repeat(32)};
async function ingest(type:string,email='builder@example.com',at='2026-10-27T12:00:00Z'){
 const event=normalizeInstantlyEvent({workspace:config.workspaceId,campaign_id:config.campaignIds.materials_sales,timestamp:at,event_type:type,lead_email:email,email_id:crypto.randomUUID()},config)!;
 const result=await db.query<{value:{id:string}}>('select outreach_ingest($1::jsonb) as value',[JSON.stringify(event)]);
 return result.rows[0].value.id;
}
async function claim(lane='fast',id:string|null=null){return (await db.query<{id:string;lease_token:string;event:OutreachEvent}>('select * from outreach_claim_lane(25,$1,$2)',[lane,id])).rows;}
async function apply(row:Awaited<ReturnType<typeof claim>>[number]){return db.query('select outreach_apply($1,$2,$3::jsonb,$4::jsonb)',[row.id,row.lease_token,JSON.stringify(planOutreachEvent(row.event)),JSON.stringify(row.event)]);}
beforeAll(async()=>{db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');for(const name of ['20260909210000_outreach_foundation.sql','20261023120000_outreach_staff_leads.sql','20261027173542_outreach_priority_queue.sql'])await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));},30000);
beforeEach(async()=>{await db.exec('truncate outreach_contacts cascade');});
afterAll(async()=>{await db.close();});
it('hands off interested prospects ahead of a large sent-email backlog',async()=>{
 for(let i=0;i<35;i++)await ingest('email_sent',`prospect${i}@example.com`,'2026-10-26T12:00:00Z');
 const interested=await ingest('lead_interested');await ingest('reply_received','reply@example.com');
 const rows=await claim();expect(rows).toHaveLength(25);expect(rows.some(r=>r.id===interested)).toBe(true);expect(rows.every(r=>r.event.type!=='reply_received')).toBe(true);
 for(const row of rows)await apply(row);
 expect((await db.query('select * from outreach_leads')).rows).toHaveLength(1);
 expect(await claim('reply')).toHaveLength(1);
});
it('leases an exact webhook once and preserves immediate suppression',async()=>{
 const id=await ingest('lead_interested');const rows=await claim('fast',id);expect(rows).toHaveLength(1);expect(await claim('fast',id)).toHaveLength(0);
 await ingest('lead_unsubscribed');await apply(rows[0]);expect((await db.query('select * from outreach_leads')).rows).toHaveLength(0);
});
it('retry claims respect the backoff and reclaim expired leases',async()=>{
 const id=await ingest('lead_interested');await claim('fast',id);
 await db.exec("update outreach_events set locked_until=now()-interval '1 minute'");expect(await claim('fast',id)).toHaveLength(1);
 await db.exec("update outreach_events set status='pending',available_at=now()+interval '1 hour'");expect(await claim('fast',id)).toHaveLength(0);
});
it('denies queue claims to public and authenticated browser roles',async()=>{
 for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(claim()).rejects.toThrow('permission denied');await db.exec('reset role');}
});
