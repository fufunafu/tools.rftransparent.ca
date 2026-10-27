'use client';

import { useEffect, useRef, useState } from 'react';
import {
  GENERAL_INBOX, callResults, callResultLabels, outreachLeadStages, safeQuoteLink, leadIsClosed,
  type CallResult, type LeadActivity, type LeadSummary, type LeadSync, type StaffLead, type OutreachLeadStage,
} from '@/lib/outreach/staff-leads';
import OutreachProviderStatus from './OutreachProviderStatus';
import { campaignNames } from '@/lib/outreach/types';

const title = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const date = (value: string | null | undefined) => value ? new Date(value).toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : 'Not recorded';
const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const button = 'min-h-10 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
const primary = 'min-h-10 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50';
interface History {
  lead: StaffLead; activity: LeadActivity[];
  mail: {id:string;direction:string;received_at:string;subject:string;body:string}[];
  events: {id:string;event_type:string;occurred_at:string;event:{body:string;subject:string;mailbox:string|null;bodyComplete:boolean}}[];
  audit: {id:string;actor_email:string;action:string;detail:{note?:string;nextAction?:string;stage?:string};created_at:string}[];
}
function localDate(value:string|null) {
  if (!value) return '';
  const d = new Date(value);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
function money(amount:number|string|null, currency:string|null) {
  return amount === null || amount === undefined ? 'Amount not recorded' : new Intl.NumberFormat(undefined,{style:'currency',currency:currency||'USD'}).format(Number(amount));
}
function Stage({value}:{value:StaffLead['stage']}) {
  const color = value==='won' ? 'bg-emerald-50 text-emerald-800' : value==='suppressed' ? 'bg-red-50 text-red-800' : value==='quote_sent' ? 'bg-violet-50 text-violet-800' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${color}`}>{value==='suppressed'?'Do not contact':title(value)}</span>;
}
function QuoteLink({url,children}:{url:string|null;children:React.ReactNode}) {
  const safe=safeQuoteLink(url);
  return safe?<a href={safe} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 underline decoration-blue-200 underline-offset-2">{children}</a>:<span className="font-medium">{children}</span>;
}

export default function OutreachLeadsDashboard() {
  const [leads,setLeads]=useState<StaffLead[]>([]);
  const [total,setTotal]=useState(0),[page,setPage]=useState(0),[refresh,setRefresh]=useState(0);
  const [filter,setFilter]=useState(''),[campaign,setCampaign]=useState(''),[owner,setOwner]=useState('');
  const [searchDraft,setSearchDraft]=useState(''),[search,setSearch]=useState('');
  const [dueOnly,setDueOnly]=useState(false),[loading,setLoading]=useState(true);
  const [summary,setSummary]=useState<LeadSummary|null>(null),[sync,setSync]=useState<LeadSync|null>(null);
  const [currentUser,setCurrentUser]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<StaffLead|null>(null),[asOf,setAsOf]=useState(0);
  useEffect(()=>{if(searchDraft===search)return;const timer=setTimeout(()=>{setLoading(true);setSearch(searchDraft);setPage(0);},250);return()=>clearTimeout(timer);},[searchDraft,search]);
  useEffect(()=>{const timer=setInterval(()=>{setLoading(true);setRefresh(n=>n+1);},60000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{
    const controller=new AbortController();
    const q=new URLSearchParams({page:String(page),stage:filter,campaign,owner,search,due:String(dueOnly)});
    fetch(`/api/outreach/leads?${q}`,{cache:'no-store',signal:controller.signal}).then(async r=>{
      const result=await r.json();
      if(!r.ok)throw Error(result.error||'Unable to load leads');
      if(!controller.signal.aborted){setLeads(result.leads);setTotal(result.total);setSummary(result.summary??null);setSync(result.sync??null);setCurrentUser(result.currentUser??'');setAsOf(Date.now());setError('');}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[page,filter,campaign,owner,search,dueOnly,refresh]);
  const reload=()=>{setLoading(true);setRefresh(n=>n+1);};
  const filtered=Boolean(filter||campaign||owner||search||dueOnly);
  const syncStale=sync && asOf-Date.parse(sync.lastRunAt)>15*60000;
  function saved(message:string){setSelected(null);setNotice(message);reload();}
  return <main className="mx-auto max-w-[1500px] space-y-6 text-slate-800">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-sm font-medium text-blue-700">Customer service / Outreach</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Outreach leads</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Interested prospects, calls, quotes and next steps. Every logged call and quote records who handled it.</p></div>
      <button className={button} disabled={loading} onClick={reload}>{loading?'Refreshing...':'Refresh'}</button>
    </header>
    {notice&&<p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
    {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <OutreachProviderStatus campaign={campaign} refresh={refresh}/>
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="All outreach lead totals">
      {([['Open leads',summary?.open],['Need first call',summary?.needsCall],['Quotes recorded',summary?.quoted],['Follow-ups due',summary?.due]] as const).map(([label,value])=><div key={label} className="rounded-xl border border-slate-200 bg-white px-5 py-4"><p className="text-sm text-slate-500">{label}</p><p className={`mt-2 text-3xl font-semibold tabular-nums ${label==='Follow-ups due'&&value?'text-amber-700':''}`}>{error?'Unavailable':value??'...'}</p></div>)}
    </section>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <label className="min-w-[220px] flex-1 text-xs font-medium text-slate-600">Search company or email<input className={field} value={searchDraft} placeholder="Find a client..." onChange={e=>setSearchDraft(e.target.value)}/></label>
        <label className="text-xs font-medium text-slate-600">Stage<select className={field} value={filter} onChange={e=>{setLoading(true);setFilter(e.target.value);setPage(0);}}><option value="">All stages</option>{[...outreachLeadStages,'suppressed'].map(s=><option key={s} value={s}>{title(s)}</option>)}</select></label>
        <label className="text-xs font-medium text-slate-600">Campaign<select className={field} value={campaign} onChange={e=>{setLoading(true);setCampaign(e.target.value);setPage(0);}}><option value="">All campaigns</option><option value="materials_sales">Materials sales</option><option value="installer_network">Installer network</option></select></label>
        <label className="text-xs font-medium text-slate-600">Owner<select className={field} value={owner} onChange={e=>{setLoading(true);setOwner(e.target.value);setPage(0);}}><option value="">Everyone</option><option value="mine">Assigned to me</option><option value="unassigned">Unassigned</option></select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={dueOnly} onChange={e=>{setLoading(true);setDueOnly(e.target.checked);setPage(0);}}/>Due now</label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-3 text-xs text-slate-500"><p>{loading?'Loading leads...':`${total} ${total===1?'lead':'leads'}${filtered?' matching filters':''}`} · Interested replies only</p><p className={sync && (sync.status!=='success'||syncStale)?'text-amber-800':''}>{sync?`${sync.status==='success'&&!syncStale?'Last sync':'Sync needs attention'}: ${date(sync.lastRunAt)}`:'Sync status unavailable'}</p></div>
      {!error&&<div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm" aria-label="Outreach leads">
        <thead className="border-y border-slate-200 text-xs uppercase tracking-wide text-slate-500"><tr>{['Client','Stage / owner','Last call','Latest quote','Next follow-up',''].map((h,i)=><th key={i} scope="col" aria-label={h||'Open lead'} className="px-4 py-3 font-medium">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">{leads.map(lead=><tr key={lead.id} className="align-top hover:bg-slate-50/70">
          <td className="max-w-[260px] px-4 py-4"><button onClick={()=>setSelected(lead)} className="text-left font-semibold text-slate-900 hover:text-blue-700">{lead.contact.company_name||lead.contact_name||lead.contact.email}</button><p className="mt-1 break-all text-xs text-slate-500">{lead.contact.email}</p>{lead.phone&&<p className="mt-1 text-xs text-slate-600">{lead.phone}</p>}<p className="mt-2 text-xs text-slate-400">{campaignNames[lead.campaign.campaign_key]}</p></td>
          <td className="max-w-[190px] px-4 py-4"><Stage value={lead.stage}/><p className="mt-2 break-all text-xs text-slate-500">{lead.owner_email||'Unassigned'}</p></td>
          <td className="max-w-[200px] px-4 py-4">{lead.last_call_at?<><p className="font-medium">{lead.last_call_result?callResultLabels[lead.last_call_result]:'Call recorded'}</p><p className="mt-1 break-all text-xs text-slate-600" title={lead.last_called_by||''}>{lead.last_called_by_name||lead.last_called_by}</p><p className="mt-1 text-xs text-slate-400">{date(lead.last_call_at)}</p><p className="mt-1 text-xs text-slate-400">{lead.call_count} {lead.call_count===1?'attempt':'attempts'}</p></>:<span className="text-slate-400">Not called</span>}</td>
          <td className="max-w-[200px] px-4 py-4">{lead.quote_sent_at?<><QuoteLink url={lead.quote_url}>{lead.quote_number}</QuoteLink><p className="mt-1 text-xs">{money(lead.quote_amount,lead.quote_currency)} {lead.quote_amount!==null&&lead.quote_currency}</p><p className="mt-1 break-all text-xs text-slate-600" title={lead.quoted_by||''}>{lead.quoted_by_name||lead.quoted_by}</p><p className="mt-1 text-xs text-slate-400">{date(lead.quote_sent_at)}</p></>:<span className="text-slate-400">No quote recorded</span>}</td>
          <td className="max-w-[230px] px-4 py-4">{leadIsClosed(lead.stage)?<span className="text-slate-400">{lead.stage==='suppressed'?'Do not contact':'Closed'}</span>:<><p className="text-sm">{lead.next_action||'Set the next action'}</p><p className={`mt-2 text-xs ${lead.next_follow_up_at&&Date.parse(lead.next_follow_up_at)<=asOf?'font-medium text-amber-800':'text-slate-500'}`}>{lead.next_follow_up_at?date(lead.next_follow_up_at):'Not scheduled'}</p></>}</td>
          <td className="px-4 py-4"><button className={button} aria-label={`Open ${lead.contact.company_name||lead.contact.email}`} onClick={()=>setSelected(lead)}>Open</button></td>
        </tr>)}</tbody>
      </table></div>}
      {!loading&&!error&&!leads.length&&<div className="px-6 py-14 text-center"><h2 className="font-semibold">{filtered?'No leads match these filters':'No interested leads yet'}</h2><p className="mt-2 text-sm text-slate-500">{filtered?'Try another search or stage.':'Prospects appear here after Instantly marks their reply as interested. Raw campaign prospects stay in Instantly.'}</p></div>}
      <nav aria-label="Lead pages" className="flex items-center justify-between border-t border-slate-200 px-4 py-3"><p className="text-xs text-slate-500">Page {page+1} of {Math.max(1,Math.ceil(total/50))}</p><div className="flex gap-2"><button className={button} disabled={loading||page===0} onClick={()=>{setLoading(true);setPage(p=>p-1);}}>Previous</button><button className={button} disabled={loading||(page+1)*50>=total} onClick={()=>{setLoading(true);setPage(p=>p+1);}}>Next</button></div></nav>
    </section>
    <p className="text-xs text-slate-500">Reply to prospects in {GENERAL_INBOX}. Calls and quotes are logged here by the person who handled them.</p>
    {selected&&<LeadWorkspace key={selected.id} initial={selected} currentUser={currentUser} onClose={()=>setSelected(null)} onSaved={saved}/>}
  </main>;
}

function LeadWorkspace({initial,currentUser,onClose,onSaved}:{initial:StaffLead;currentUser:string;onClose:()=>void;onSaved:(message:string)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [history,setHistory]=useState<History|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  const [tab,setTab]=useState<'details'|'call'|'quote'|'note'>('details');
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();return()=>previous?.focus();},[]);
  useEffect(()=>{
    const c=new AbortController();
    fetch(`/api/outreach/leads?id=${initial.id}`,{cache:'no-store',signal:c.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'History unavailable');if(!c.signal.aborted)setHistory(v);}).catch(e=>{if(!c.signal.aborted)setError(e.message);});
    return()=>c.abort();
  },[initial.id,refresh]);
  const lead=history?.lead??initial;
  const closed=leadIsClosed(lead.stage),suppressed=lead.stage==='suppressed';
  return <dialog ref={dialog} onCancel={onClose} aria-labelledby="outreach-lead-title" className="m-auto max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-5xl overflow-y-auto rounded-2xl bg-white p-0 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
    <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-6 py-5"><div><h2 id="outreach-lead-title" className="text-xl font-semibold">{lead.contact.company_name||lead.contact_name||lead.contact.email}</h2><p className="mt-1 break-all text-sm text-slate-500">{lead.contact.email}</p><div className="mt-3 flex flex-wrap items-center gap-3"><Stage value={lead.stage}/><span className="text-xs text-slate-500">Owner: {lead.owner_email||'Unassigned'}</span></div></div><button className={button} onClick={onClose} aria-label="Close lead">Close</button></div>
    <div className="p-6">
      {error?<div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}<button className={`${button} ml-3`} onClick={()=>{setHistory(null);setError('');setRefresh(n=>n+1);}}>Retry</button></div>:!history?<p role="status" className="py-8 text-sm text-slate-500">Loading lead and activity...</p>:<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-w-0">
          {suppressed?<p role="status" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">Do not contact. This lead has been suppressed.</p>:<>
            <div className="mb-5 flex flex-wrap gap-2" aria-label="Lead actions">{([['details','Follow-up'],['call','Log call'],['quote','Log quote'],['note','Add note']] as const).map(([value,label])=><button key={value} className={`${button} ${tab===value?'border-blue-300 bg-blue-50 text-blue-800':''}`} aria-pressed={tab===value} disabled={closed&&(value==='call'||value==='quote')} onClick={()=>setTab(value)}>{label}</button>)}</div>
            {closed&&<p className="mb-4 text-sm text-slate-500">This lead is closed. Reopen its stage before logging a new call or quote.</p>}
            {tab==='details'?<LeadDetails lead={lead} onSaved={()=>onSaved('Lead and follow-up saved.')}/>:<ActivityForm key={`${lead.id}:${tab}`} lead={lead} kind={tab} currentUser={currentUser} onSaved={()=>onSaved(tab==='call'?'Call recorded with staff attribution.':tab==='quote'?'Quote recorded with staff attribution.':'Note added to the activity history.')}/>}
          </>}
          <details className="mt-7 border-t border-slate-200 pt-5"><summary className="cursor-pointer text-sm font-semibold">Email conversation</summary><p className="mt-2 text-xs text-slate-500">Inbox last checked: {date(lead.mail_synced_at)}</p>{lead.mail_sync_error&&<p className="mt-2 text-sm text-amber-800">{lead.mail_sync_error}</p>}
            {history.mail?.map(m=><article key={m.id} className="mt-3 rounded-lg bg-blue-50 p-3"><p className="text-xs text-slate-500">{m.direction==='outbound'?'Team reply':'Prospect reply'} · {date(m.received_at)}</p><p className="mt-1 text-sm font-medium">{m.subject}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p></article>)}
            {!history.mail?.length&&history.events.filter(e=>e.event_type!=='email_sent').map(e=><article key={e.id} className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{title(e.event_type)} · {date(e.occurred_at)}</p>{e.event.subject&&<p className="mt-1 text-sm font-medium">{e.event.subject}</p>}<p className="mt-2 whitespace-pre-wrap break-words text-sm">{e.event.body||'Open the original conversation in the general inbox.'}</p>{e.event.body&&!e.event.bodyComplete&&<p className="mt-2 text-xs text-amber-800">Preview only. Review the full email in the inbox.</p>}</article>)}
          </details>
        </section>
        <section className="min-w-0 border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><h3 className="font-semibold">Activity history</h3><p className="mt-1 text-xs text-slate-500">Who called, who quoted, and what happened.</p>
          {!history.activity?.length&&<p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-500">No calls, quotes or notes recorded yet.</p>}
          {history.activity?.map(a=><Activity key={a.id} value={a}/>)}
          <details className="mt-6 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-medium text-slate-600">Lead updates</summary>{history.audit.filter(a=>a.action!=='lead_activity_logged').map(a=><article key={a.id} className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium">{title(a.action)}</p><p className="mt-1 break-all text-xs text-slate-500">{a.actor_email} · {date(a.created_at)}</p>{a.detail.stage&&<p className="mt-2">Stage: {title(a.detail.stage)}</p>}<p className="mt-1 whitespace-pre-wrap">{a.detail.nextAction}</p><p className="mt-1 whitespace-pre-wrap">{a.detail.note}</p></article>)}</details>
        </section>
      </div>}
    </div>
  </dialog>;
}
function LeadDetails({lead,onSaved}:{lead:StaffLead;onSaved:()=>void}) {
  const [stage,setStage]=useState<OutreachLeadStage>(lead.stage==='suppressed'?'lost':lead.stage);
  const [due,setDue]=useState(localDate(lead.next_follow_up_at)),[action,setAction]=useState(lead.next_action),[note,setNote]=useState(lead.notes);
  const [contactName,setContactName]=useState(lead.contact_name||''),[phone,setPhone]=useState(lead.phone||'');
  const [claim,setClaim]=useState(!lead.owner_email),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
    const r=await fetch('/api/outreach/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:lead.id,version:lead.version,stage,due:due?new Date(due).toISOString():null,action,note,claim,contactName,phone})});
    const v=await r.json();if(!r.ok)throw Error(v.error||'Unable to save');onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}
  const closed=['won','lost'].includes(stage);
  return <form onSubmit={save} className="space-y-4" aria-label="Lead follow-up">
    <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm font-medium">Contact name<input className={field} maxLength={200} value={contactName} onChange={e=>setContactName(e.target.value)}/></label><label className="block text-sm font-medium">Phone<input type="tel" className={field} maxLength={60} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Add a phone number"/></label></div>
    <label className="block text-sm font-medium">Stage<select className={field} value={stage} onChange={e=>setStage(e.target.value as OutreachLeadStage)}>{outreachLeadStages.map(s=><option key={s} value={s}>{title(s)}</option>)}</select></label>
    <label className="block text-sm font-medium">Next action<input required={!closed} minLength={closed?undefined:3} maxLength={1000} className={field} value={action} onChange={e=>setAction(e.target.value)}/></label>
    <label className="block text-sm font-medium">Follow-up date and time<input type="datetime-local" required={!closed} className={field} value={due} onChange={e=>setDue(e.target.value)}/></label>
    <label className="block text-sm font-medium">Client notes<textarea rows={3} maxLength={4000} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={claim} onChange={e=>setClaim(e.target.checked)}/>Assign this lead to me</label>
    {stage==='quote_sent'&&!lead.quote_sent_at&&<p className="text-xs text-amber-800">Use Log quote to record the quote reference and who sent it. A stage change alone does not create a quote record.</p>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<button className={`${primary} w-full`} disabled={busy}>{busy?'Saving...':'Save lead'}</button>
  </form>;
}
function ActivityForm({lead,kind,currentUser,onSaved}:{lead:StaffLead;kind:'call'|'quote'|'note';currentUser:string;onSaved:()=>void}) {
  const [at,setAt]=useState(()=>localDate(new Date().toISOString()));
  const [due,setDue]=useState(()=>localDate(new Date(Date.now()+(kind==='quote'?2:1)*86400000).toISOString()));
  const [action,setAction]=useState(kind==='quote'?'Follow up on the quote':'Follow up with the client');
  const [note,setNote]=useState(''),[result,setResult]=useState<CallResult>('connected');
  const [reference,setReference]=useState(''),[amount,setAmount]=useState(''),[currency,setCurrency]=useState('USD'),[url,setUrl]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const attempt=useRef<{body:string;id:string}|null>(null);
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
    const base={id:lead.id,version:lead.version,kind,at:new Date(at).toISOString(),note,
      ...(kind==='note'?{}:{due:new Date(due).toISOString(),action}),
      ...(kind==='call'?{result}:{}),...(kind==='quote'?{reference,amount:amount===''?null:Number(amount),currency,url}:{}),
    };
    const body=JSON.stringify(base);
    if(attempt.current?.body!==body)attempt.current={body,id:crypto.randomUUID()};
    const r=await fetch('/api/outreach/leads/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...base,requestId:attempt.current.id})});
    const v=await r.json();if(!r.ok)throw Error(v.error||'Unable to record activity');onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Unable to record activity');}finally{setBusy(false);}}
  return <form onSubmit={save} className="space-y-4" aria-label={`Record ${kind}`}>
    <div className="rounded-lg bg-blue-50 p-3 text-sm"><p className="font-medium">{kind==='call'?'Record a completed call or attempt':kind==='quote'?'Record a quote already sent':'Add a note to the client history'}</p><p className="mt-1 break-all text-xs text-blue-800">Recorded by {currentUser||'your signed-in account'}. {kind==='quote'?'This records the quote; it does not send an email.':kind==='call'?'This logs your call; it does not place a call.':''}</p></div>
    {kind==='call'&&<><p className="text-sm text-slate-600">Phone: {lead.phone||'Not recorded. Add it under Follow-up.'}</p><label className="block text-sm font-medium">Call outcome<select className={field} value={result} onChange={e=>setResult(e.target.value as CallResult)}>{callResults.map(v=><option key={v} value={v}>{callResultLabels[v]}</option>)}</select></label></>}
    {kind==='quote'&&<><label className="block text-sm font-medium">Quote number or reference<input required maxLength={120} className={field} value={reference} onChange={e=>setReference(e.target.value)} placeholder="e.g. GRS-1042"/></label><div className="grid grid-cols-[1fr_100px] gap-3"><label className="block text-sm font-medium">Quote amount<input type="number" min="0" max="999999999999.99" step="0.01" className={field} value={amount} onChange={e=>setAmount(e.target.value)} placeholder="Optional"/></label><label className="block text-sm font-medium">Currency<select className={field} value={currency} onChange={e=>setCurrency(e.target.value)}><option>USD</option><option>CAD</option></select></label></div><label className="block text-sm font-medium">Quote link<input type="url" maxLength={2000} className={field} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://... (optional)"/></label></>}
    <label className="block text-sm font-medium">{kind==='call'?'Call date and time':kind==='quote'?'Quote sent date and time':'Note date and time'}<input type="datetime-local" required className={field} value={at} onChange={e=>setAt(e.target.value)}/></label>
    <label className="block text-sm font-medium">{kind==='note'?'Note':'Outcome / notes'}<textarea required={kind==='note'} maxLength={4000} rows={3} className={field} value={note} onChange={e=>setNote(e.target.value)} placeholder={kind==='call'?'What did you discuss?':undefined}/></label>
    {kind!=='note'&&<><label className="block text-sm font-medium">Next action<input required minLength={3} maxLength={1000} className={field} value={action} onChange={e=>setAction(e.target.value)}/></label><label className="block text-sm font-medium">Next follow-up<input type="datetime-local" required className={field} value={due} onChange={e=>setDue(e.target.value)}/></label></>}
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<button className={`${primary} w-full`} disabled={busy}>{busy?'Recording...':kind==='call'?'Record call':kind==='quote'?'Record quote':'Add note'}</button>
  </form>;
}
function Activity({value:a}:{value:LeadActivity}) {
  return <article className="mt-4 rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{a.kind==='call'?'Call':a.kind==='quote'?'Quote sent':'Note'}</h4><span className="text-xs text-slate-400">{date(a.occurred_at)}</span></div><p className="mt-1 break-all text-xs text-slate-500" title={a.actor_email}>{a.actor_name||a.actor_email}{a.actor_name!==a.actor_email&&<span className="block">{a.actor_email}</span>}</p>
    {a.kind==='call'&&a.call_result&&<p className="mt-3 text-sm font-medium">{callResultLabels[a.call_result]}</p>}
    {a.kind==='quote'&&<div className="mt-3 text-sm"><QuoteLink url={a.quote_url}>{a.quote_number}</QuoteLink><p className="mt-1">{money(a.quote_amount,a.quote_currency)} {a.quote_amount!==null&&a.quote_currency}</p></div>}
    {a.note&&<p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{a.note}</p>}
  </article>;
}
