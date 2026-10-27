import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeInstantlyEvent, planOutreachEvent } from './domain';
let db: PGlite;
const config = { workspaceId: '11111111-1111-4111-8111-111111111111', campaignIds: { installer_network: '22222222-2222-4222-8222-222222222222', materials_sales: '33333333-3333-4333-8333-333333333333' }, webhookSecret: 'x'.repeat(32) };
async function event(type = 'lead_interested') {
  const e = normalizeInstantlyEvent({ workspace: config.workspaceId, campaign_id: config.campaignIds.materials_sales, timestamp: '2026-10-23T12:00:00Z', event_type: type, lead_email: 'fixture@example.com', email_id: randomUUID(), reply_text: 'Interested in a quote' }, config)!;
  await db.query('select outreach_ingest($1::jsonb)', [JSON.stringify(e)]);
  const rows = (await db.query<{ id: string; lease_token: string; event: typeof e }>('select * from outreach_claim(25)')).rows;
  for (const r of rows) await db.query('select outreach_apply($1,$2,$3::jsonb,$4::jsonb)', [r.id, r.lease_token, JSON.stringify(planOutreachEvent(r.event)), JSON.stringify(r.event)]);
}
async function rf() { return (await db.query<Record<string, unknown>>('select * from leads')).rows; }
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const file of ['023_leads.sql', '20260804201000_leads_not_applicable.sql', '20260824120000_leads_store_id.sql', '20260909221500_outreach_lead_source.sql', '20260909210000_outreach_foundation.sql', '20261023120000_outreach_staff_leads.sql', '20261027020000_outreach_lead_activity.sql']) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await event();
  await db.exec(await readFile('supabase/migrations/20261027200000_outreach_rf_leads.sql', 'utf8'));
}, 30000);
afterAll(async () => { await db.close(); });
describe('RF outreach acquisition bridge', () => {
  it('backfills existing interested tickets with the original interest date', async () => {
    expect(await rf()).toEqual([expect.objectContaining({ source: 'outreach', store_id: 'rf_transparent', email: 'fixture@example.com', message: 'Interested in a quote', submitted_at: new Date('2026-10-23T12:00:00Z'), outcome: 'new' })]);
  });
  describe('future events', () => {
    beforeEach(async () => { await db.exec('truncate outreach_contacts cascade'); });
    it('ignores cold prospects and unclassified replies, creates only one RF ticket on interest retries', async () => {
      await event('email_sent'); await event('reply_received'); expect(await rf()).toHaveLength(0);
      await event(); await event(); expect(await rf()).toHaveLength(1);
    });
    it('enriches contact details without overwriting RF staff work', async () => {
      await event();
      await db.exec("update leads set name='Employee corrected name', outcome='quoted', call_status='called', quote_number='Q100', assigned_to='employee@example.com', notes='Keep this'; update outreach_leads set contact_name='Provider name', phone='+14165551234';");
      expect((await rf())[0]).toMatchObject({ name: 'Employee corrected name', phone: '+14165551234', outcome: 'quoted', call_status: 'called', quote_number: 'Q100', assigned_to: 'employee@example.com', notes: 'Keep this' });
    });
    it('carries opt-outs through to RF and cannot reopen them on profile refresh', async () => {
      await event(); await event('lead_unsubscribed');
      await db.exec("update outreach_leads set phone='+14165551234'");
      expect((await rf())[0]).toMatchObject({ outcome: 'not_applicable', not_applicable_reason: 'Do not contact: outreach suppressed' });
    });
    it('keeps unrelated website leads intact and refreshes the actual reply', async () => {
      await db.exec("insert into leads(source,raw_payload,email) values ('website','{}','website@example.com')");
      await event();
      await db.exec("select outreach_lead_receive_mail(id,'message','thread','inbound','2026-10-24T12:00Z','Please quote 40 feet','Project',false,false) from outreach_leads");
      expect(await rf()).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'website', email: 'website@example.com' }), expect.objectContaining({ source: 'outreach', message: 'Please quote 40 feet' })]));
    });
    it('denies public invocation of the bridge', async () => {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        await expect(db.query('select outreach_sync_rf_lead($1)', [randomUUID()])).rejects.toThrow('permission denied');
        await db.exec('reset role');
      }
    });
  });
});
