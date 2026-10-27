import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const mock=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({getAuthenticatedUser:mock.user}));
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({rpc:mock.rpc,from:mock.from})}));
import {GET,POST} from './route';
const payload={id:'11111111-1111-4111-8111-111111111111',version:1,stage:'contacted',due:'2026-10-27T12:00:00Z',action:'Request project plans',note:'Spoke to prospect',claim:true};
function request(body=payload,origin='https://tools.example'){return new Request('https://tools.example/api/outreach/leads',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();mock.user.mockResolvedValue({email:'employee@example.com'});mock.rpc.mockResolvedValue({error:null});});
describe('staff lead access and updates',()=>{
 it('requires an authenticated employee for reads and writes',async()=>{mock.user.mockResolvedValue(null);expect((await GET(new Request('https://tools.example/api/outreach/leads'))).status).toBe(401);expect((await POST(request())).status).toBe(401);expect(mock.from).not.toHaveBeenCalled();expect(mock.rpc).not.toHaveBeenCalled();});
 it('rejects cross-origin mutations',async()=>{expect((await POST(request(payload,'https://attacker.example'))).status).toBe(403);expect(mock.rpc).not.toHaveBeenCalled();});
 it('uses authenticated identity instead of submitted owner identity',async()=>{expect((await POST(request({...payload,actor:'someone-else@example.com'} as typeof payload))).status).toBe(200);expect(mock.rpc).toHaveBeenCalledWith('outreach_lead_update',expect.objectContaining({p_actor:'employee@example.com',p_version:1}));});
 it('requires a due date on active leads but allows closing',async()=>{expect((await POST(request({...payload,due:null} as unknown as typeof payload))).status).toBe(400);expect((await POST(request({...payload,stage:'won',due:null} as unknown as typeof payload))).status).toBe(200);});
 it('reports concurrent updates without overwriting',async()=>{mock.rpc.mockResolvedValue({error:{message:'version changed'}});expect((await POST(request())).status).toBe(409);});
});
