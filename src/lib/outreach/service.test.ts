import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const rpc=vi.hoisted(()=>vi.fn());
const hydrate=vi.hoisted(()=>vi.fn(async(event)=>event));
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({rpc})}));
vi.mock('./instantly',()=>({hydrateReply:hydrate,InstantlyError:class extends Error {code='test';}}));
import {processOutreachEvents,processImmediateOutreachEvent} from './service';
const row=(id:string,type='lead_interested')=>({id,lease_token:'lease',event:{type,campaignKey:'materials_sales',body:'',bodyComplete:true}});
beforeEach(()=>{vi.clearAllMocks();rpc.mockResolvedValue({data:[],error:null});});
it('drains a delivery backlog separately before taking the bounded reply batch',async()=>{
 let fast=0;
 rpc.mockImplementation(async(name,args)=>name==='outreach_claim_lane'?{data:args.p_lane==='fast'?(fast++===0?Array.from({length:25},(_,i)=>row(String(i),'email_sent')):[row('interest')]):[row('reply','reply_received')],error:null}:{data:'processed',error:null});
 expect(await processOutreachEvents()).toEqual({claimed:27,processed:27,held:0,errors:0});
 expect(rpc).toHaveBeenCalledWith('outreach_claim_lane',{p_limit:5,p_lane:'reply',p_event_id:null});
});
it('claims only the committed webhook id and records retryable failures',async()=>{
 rpc.mockImplementation(async(name)=>name==='outreach_claim_lane'?{data:[row('interest')],error:null}:name==='outreach_apply'?{error:{message:'temporary'}}:{error:null});
 expect((await processImmediateOutreachEvent('interest')).errors).toBe(1);
 expect(rpc).toHaveBeenCalledWith('outreach_claim_lane',{p_limit:1,p_lane:'fast',p_event_id:'interest'});
 expect(rpc).toHaveBeenCalledWith('outreach_fail',expect.objectContaining({p_id:'interest',p_lease:'lease'}));
});
