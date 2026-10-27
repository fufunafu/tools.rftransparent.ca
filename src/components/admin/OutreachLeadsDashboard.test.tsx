// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import OutreachLeadsDashboard from './OutreachLeadsDashboard';
let root:Root,container:HTMLDivElement;
const lead={id:'11111111-1111-4111-8111-111111111111',version:1,stage:'new',owner_email:null,next_action:'Reply to the prospect',next_follow_up_at:'2026-10-23T12:00:00Z',notes:'',mail_synced_at:null,mail_sync_error:null,contact_name:'',phone:'',call_count:0,last_call_at:null,quote_sent_at:null,contact:{email:'fixture@example.com',company_name:'Example Builder'},campaign:{campaign_key:'materials_sales'}};
function responses(row=lead,activity:unknown[]=[]){return vi.fn(async(url:string,init?:RequestInit)=>new Response(JSON.stringify(init?.method==='POST'?{saved:true}:url.includes('?id=')?{lead:row,events:[],audit:[],mail:[],activity}:{leads:[row],total:1,page:0,summary:{open:1,needsCall:1,quoted:0,due:1},currentUser:'employee@example.com'})));}
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',responses());container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(<OutreachLeadsDashboard/>));}
async function click(text:string){const b=Array.from(container.querySelectorAll('button')).find(x=>x.textContent===text);expect(b).toBeDefined();await act(async()=>b!.click());}
async function open(){await click('Open');}
async function submit(){await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('shows an operational table and saves contact details with a required follow-up',async()=>{await render();expect(container.querySelector('table')?.textContent).toContain('Last call');expect(container.textContent).toContain('No quote recorded');await open();expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.required).toBe(true);await submit();const post=vi.mocked(fetch).mock.calls.find(([,v])=>v?.method==='POST');expect(post?.[0]).toBe('/api/outreach/leads');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({id:lead.id,version:1,claim:true,contactName:'',phone:''});});
it('records a call with a retry key and does not accept staff attribution from the browser',async()=>{await render();await open();await click('Log call');expect(container.textContent).toContain('Recorded by employee@example.com');await submit();const post=vi.mocked(fetch).mock.calls.find(([,v])=>v?.method==='POST');expect(post?.[0]).toBe('/api/outreach/leads/activity');const body=JSON.parse(String(post?.[1]?.body));expect(body).toMatchObject({kind:'call',result:'connected',id:lead.id,version:1});expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);expect(body.actor).toBeUndefined();expect(body.at).toBeTruthy();expect(body.due).toBeTruthy();});
it('shows the quote form and renders separate caller and quote attribution in history',async()=>{
 vi.stubGlobal('fetch',responses(lead,[{id:'call1',kind:'call',actor_email:'caller@example.com',actor_name:'Alex Caller',occurred_at:'2026-10-24T12:00:00Z',call_result:'voicemail',note:'Left a message'},{id:'quote1',kind:'quote',actor_email:'quoter@example.com',actor_name:'Jamie Quoter',occurred_at:'2026-10-25T12:00:00Z',quote_number:'Q-12',quote_amount:450,currency:'USD',quote_url:'javascript:alert(1)',note:'Sent options'}]));
 await render();await open();await click('Log quote');expect(container.textContent).toContain('Quote number or reference');expect(container.textContent).toContain('Alex Caller');expect(container.textContent).toContain('Jamie Quoter');expect(container.textContent).toContain('Left voicemail');expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});
it('preserves a failed activity submission and reuses its idempotency key on retry',async()=>{
 const fetcher=responses();vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>init?.method==='POST'?new Response(JSON.stringify({error:'Connection interrupted'}),{status:503}):fetcher(url,init)));
 await render();await open();await click('Log call');await submit();expect(container.querySelector('[role="alert"]')?.textContent).toContain('Connection interrupted');await submit();const posts=vi.mocked(fetch).mock.calls.filter(([,v])=>v?.method==='POST');expect(JSON.parse(String(posts[0][1]?.body)).requestId).toBe(JSON.parse(String(posts[1][1]?.body)).requestId);
});
it('shows suppressed leads without editable actions',async()=>{vi.stubGlobal('fetch',responses({...lead,stage:'suppressed'}));await render();await open();expect(container.textContent).toContain('Do not contact');expect(container.querySelector('form')).toBeNull();});
it('shows an unavailable queue instead of falsely claiming no leads',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Leads unavailable'}),{status:503})));await render();expect(container.querySelector('[role="alert"]')?.textContent).toBe('Leads unavailable');expect(container.textContent).not.toContain('No interested leads yet');expect(container.textContent).not.toContain('No leads match');});
it('marks unavailable automatic activity instead of showing false no-call or no-quote statuses',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({leads:[{...lead,activity_error:true}],total:1,page:0,activityError:true,summary:{open:1,needsCall:null,quoted:null,due:1}})));
 await render();expect(container.querySelector('table')?.textContent).toContain('Activity unavailable');expect(container.querySelector('table')?.textContent).not.toContain('No quote recorded');
});
