import {expect,it,vi} from 'vitest';
vi.mock('@/lib/supabase',()=>({getSupabase:vi.fn()}));
vi.mock('@/lib/shopify',()=>({getStores:()=>[{id:'store2',store:'test.myshopify.com'}]}));
import {deriveAutomaticActivity,applyAutomaticActivity,automaticSummary,type ActivityLead} from './automatic-activity';
import type {PhoneCallForLeadSync} from '@/lib/lead-call-sync';
import type {DraftForLeadQuoteSync} from '@/lib/lead-quote-sync';
const lead={id:'one',contact:{email:'builder@example.com',company_name:'Builder'},phone:'+1 416 555 0100',created_at:'2026-10-27T12:00:00Z',interested_at:'2026-10-26T12:00:00Z',stage:'new',call_count:0,last_call_at:null,quote_sent_at:null} as ActivityLead;
const call:PhoneCallForLeadSync={id:'call1',store_id:'rf_transparent',from_number:'18005550100',to_number:'4165550100',call_start:'2026-10-26T13:00:00Z',call_end:null,direction:'outbound',duration_min:3,charge:0,endpoint:'Daniel',source:'cik'};
const draft:DraftForLeadQuoteSync={shopify_draft_id:'123',draft_name:'#D123',customer_email:'BUILDER@example.com',customer_phone:null,quote_amount:300,shopify_created_at:'2026-10-26T14:00:00Z',shopify_status:'INVOICE_SENT',first_synced_at:'2026-10-26T14:01:00Z',last_invoice_sender:'Aaron',created_by_staff:'Daniel'};
it('uses interest time before delayed ticket creation, normal call matching and staff attribution',()=>{
 const history=deriveAutomaticActivity([lead],[call],[draft]).get('one')!;
 const result=applyAutomaticActivity(lead,history);
 expect(result).toMatchObject({last_call_at:call.call_start,last_called_by_name:'Daniel',call_source:'automatic',quote_number:'#D123',quoted_by_name:'Aaron',quote_source:'automatic',quote_currency:null,quote_url:'https://test.myshopify.com/admin/draft_orders/123'});
 expect(automaticSummary([result])).toEqual({needsCall:0,quoted:1});
});
it('selects latest sent quote, excludes unsent and pre-interest activity',()=>{
 const history=deriveAutomaticActivity([lead],[{...call,call_start:'2026-10-25T13:00:00Z'}],[draft,{...draft,shopify_draft_id:'124',draft_name:'#D124',shopify_created_at:'2026-10-27T14:00:00Z'},{...draft,shopify_draft_id:'125',draft_name:'#D125',shopify_status:'OPEN',shopify_created_at:'2026-10-28T14:00:00Z'}]).get('one')!;
 expect(applyAutomaticActivity(lead,history)).toMatchObject({last_call_at:null,quote_number:'#D124'});
});
it('skips shared phone ambiguity and conflicting quote email',()=>{
 const other={...lead,id:'two',contact:{email:'other@example.com',company_name:'Other'}};
 const history=deriveAutomaticActivity([lead,other],[call],[{...draft,customer_email:null,customer_phone:lead.phone},{...draft,customer_email:'third@example.com',customer_phone:lead.phone}]);
 expect([...history.values()].flat()).toEqual([]);
});
it('retains newer manual entries and does not double count the same call',()=>{
 const manual={...lead,last_call_at:'2026-10-28T12:00:00Z',last_called_by_name:'Manual employee',call_count:1,quote_sent_at:'2026-10-28T12:00:00Z',quote_number:'Manual quote'};
 const history=deriveAutomaticActivity([lead],[call,call],[draft]).get('one')!;
 expect(applyAutomaticActivity(manual,history)).toMatchObject({last_called_by_name:'Manual employee',call_count:1,quote_number:'Manual quote'});
});
it('does not match inbound missed calls as conversations',()=>{
 expect(deriveAutomaticActivity([lead],[{...call,direction:'inbound',from_number:lead.phone,duration_min:0}],[]).size).toBe(0);
});
