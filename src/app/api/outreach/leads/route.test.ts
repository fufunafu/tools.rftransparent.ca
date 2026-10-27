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

it('saves profile fields atomically with staff attribution and rejects partial profiles',async()=>{
 expect((await POST(request({...payload,contactName:'Jordan',phone:'+1 555 010 0100'} as typeof payload))).status).toBe(200);
 expect(mock.rpc).toHaveBeenCalledWith('outreach_lead_save',expect.objectContaining({p_contact_name:'Jordan',p_phone:'+1 555 010 0100',p_actor:'employee@example.com'}));
 expect((await POST(request({...payload,phone:'111'} as typeof payload))).status).toBe(400);
});
it('rejects invalid list filters before querying the database',async()=>{
 for(const query of ['stage=unknown','page=-1','campaign=foreign','owner=someone','due=maybe'])expect((await GET(new Request(`https://tools.example/api/outreach/leads?${query}`))).status).toBe(400);
 expect(mock.from).not.toHaveBeenCalled();
});
it('escapes searches, applies due filters only to open work, and returns global queue totals',async()=>{
 const calls:Array<{method:string;args:unknown[]}>=[];
 mock.from.mockImplementation((table:string)=>{
  let head=false;
  const query:Record<string,unknown>={};
  for(const method of ['select','eq','is','not','neq','lte','or','order','range','limit','maybeSingle'])query[method]=vi.fn((...args:unknown[])=>{calls.push({method,args});if(method==='select')head=Boolean((args[1] as {head?:boolean})?.head);return query;});
  query.then=(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='cron_runs'?{status:'success',started_at:'2026-10-26T12:00:00Z'}:head?null:[],count:head?3:0,error:null}).then(resolve);
  return query;
 });
 const response=await GET(new Request('https://tools.example/api/outreach/leads?search='+encodeURIComponent('A%,company_name.eq.fake')+'&due=true&owner=mine'));
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({summary:{open:3,needsCall:3,quoted:3,due:3},currentUser:'employee@example.com'});
 const search=calls.find(x=>x.method==='or');expect(search?.args[1]).toEqual({referencedTable:'contact'});expect(search?.args[0]).toContain('email.ilike."%A');expect(search?.args[0]).toContain('\\\\%');
 expect(calls).toContainEqual({method:'not',args:['stage','in','(won,lost,suppressed)']});expect(calls).toContainEqual({method:'eq',args:['owner_email','employee@example.com']});
});
