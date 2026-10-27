import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),identity:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({getAuthenticatedUser:mock.user}));
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({rpc:mock.rpc})}));
vi.mock('@/lib/outreach/staff-identity',()=>({outreachStaffIdentity:mock.identity}));
import {POST} from './route';
const payload={id:'11111111-1111-4111-8111-111111111111',version:1,requestId:'22222222-2222-4222-8222-222222222222',kind:'call',at:'2026-10-24T12:00:00Z',note:'Discussed plans',result:'connected',due:'2026-10-28T12:00:00Z',action:'Follow up on quote'};
function request(body:unknown=payload,origin='https://tools.example'){return new Request('https://tools.example/api/outreach/leads/activity',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mock.user.mockResolvedValue({email:'employee@example.com'});mock.identity.mockResolvedValue({email:'employee@example.com',name:'Employee Name'});mock.rpc.mockResolvedValue({error:null});});
describe('record outreach activity',()=>{
 it('requires authentication and rejects cross-origin changes',async()=>{mock.user.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);mock.user.mockResolvedValue({email:'employee@example.com'});expect((await POST(request(payload,'https://attacker.example'))).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('attributes the call to the authenticated staff member, ignoring submitted identities',async()=>{expect((await POST(request({...payload,actor:'fake@example.com',name:'Fake'}))).status).toBe(200);expect(mock.identity).toHaveBeenCalledWith('employee@example.com');expect(mock.rpc).toHaveBeenCalledWith('outreach_lead_log_activity',expect.objectContaining({p_actor:'employee@example.com',p_actor_name:'Employee Name',p_call_result:'connected',p_request_id:payload.requestId}));});
 it('records quote fields without sending an email',async()=>{expect((await POST(request({...payload,kind:'quote',reference:'Q-12',amount:200.25,currency:'CAD',url:'https://example.com/quote/12'}))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('outreach_lead_log_activity',expect.objectContaining({p_quote_number:'Q-12',p_quote_amount:200.25,p_quote_currency:'CAD',p_call_result:null}));});
 it('rejects unsafe links, invalid amounts, incomplete follow-ups and future activities',async()=>{
  for(const body of [{...payload,result:'invalid'},{...payload,due:null},{...payload,at:'2099-01-01T00:00:00Z'},{...payload,kind:'quote',reference:'Q',amount:1,currency:'USD',url:'javascript:alert(1)'},{...payload,kind:'quote',reference:'Q',amount:-1,currency:'USD',url:''}])expect((await POST(request(body))).status).toBe(400);
  expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('allows a note without modifying the follow-up and reports stale versions',async()=>{expect((await POST(request({...payload,kind:'note'}))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('outreach_lead_log_activity',expect.objectContaining({p_due:null,p_action:null,p_call_result:null}));mock.rpc.mockResolvedValue({error:{message:'version mismatch'}});expect((await POST(request())).status).toBe(409);});
});
