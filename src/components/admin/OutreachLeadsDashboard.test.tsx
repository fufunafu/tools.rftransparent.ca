// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import OutreachLeadsDashboard from './OutreachLeadsDashboard';
let root:Root,container:HTMLDivElement;
const lead={id:'11111111-1111-4111-8111-111111111111',version:1,stage:'new',owner_email:null,next_action:'Reply to the prospect',next_follow_up_at:'2026-10-23T12:00:00Z',notes:'',mail_synced_at:null,mail_sync_error:null,contact:{email:'fixture@example.com',company_name:'Example Builder'},campaign:{campaign_key:'materials_sales'}};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('?id=')?{events:[],audit:[],mail:[]}:{leads:[lead],total:1,page:0}))));container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(<OutreachLeadsDashboard/>));}
async function open(){await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-pressed]')!.click());}
it('opens the ticket with a required follow-up and records a staff task without sending mail',async()=>{await render();await open();expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.required).toBe(true);await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));const post=vi.mocked(fetch).mock.calls.find(([,v])=>v?.method==='POST');expect(post?.[0]).toBe('/api/outreach/leads');expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({id:lead.id,version:1,claim:true});});
it('shows suppressed leads without a reply or update form',async()=>{vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('?id=')?{events:[],audit:[],mail:[]}:{leads:[{...lead,stage:'suppressed'}],total:1}))));await render();await open();expect(container.textContent).toContain('Do not contact');expect(container.querySelector('form')).toBeNull();});
it('shows an unavailable queue instead of falsely claiming no leads',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Leads unavailable'}),{status:503})));await render();expect(container.querySelector('[role="alert"]')?.textContent).toBe('Leads unavailable');expect(container.textContent).not.toContain('No leads in this view');});
