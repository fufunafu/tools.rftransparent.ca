'use client';
import { useEffect, useState } from 'react';
import { GENERAL_INBOX, outreachLeadStages, type StaffLead, type OutreachLeadStage } from '@/lib/outreach/staff-leads';
import { campaignNames } from '@/lib/outreach/types';
const title = (value: string) => value.replaceAll('_',' ').replace(/^./, c=>c.toUpperCase());
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'None scheduled';
const field='mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm';
const button='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50';
interface History { mail:{id:string;direction:string;received_at:string;subject:string;body:string}[]; events: { id:string; event_type:string; occurred_at:string; event:{body:string;subject:string;mailbox:string|null;bodyComplete:boolean} }[]; audit:{id:string;actor_email:string;action:string;detail:{note?:string;nextAction?:string};created_at:string}[] }
function localDate(value:string|null) {
  if (!value) return '';
  const d=new Date(value); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export default function OutreachLeadsDashboard() {
  const [leads,setLeads]=useState<StaffLead[]>([]);
  const [total,setTotal]=useState(0);
  const [asOf,setAsOf]=useState(0);
  const [page,setPage]=useState(0);
  const [filter,setFilter]=useState('');
  const [dueOnly,setDueOnly]=useState(false);
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<StaffLead|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    const q=new URLSearchParams({page:String(page),stage:filter,due:String(dueOnly)});
    fetch(`/api/outreach/leads?${q}`,{cache:'no-store',signal:controller.signal}).then(async r=>{
      const result=await r.json(); if (!r.ok) throw Error(result.error||'Unable to load leads');
      if (!controller.signal.aborted) {setLeads(result.leads);setSelected(current=>current ? result.leads.find((lead:StaffLead)=>lead.id===current.id)??current : null);setTotal(result.total);setAsOf(Date.now());setError('');}
    }).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[page,filter,dueOnly,refresh]);
  function reload(){setLoading(true);setRefresh(n=>n+1);}
  return <main className="mx-auto max-w-7xl space-y-6 text-slate-800">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-blue-700">Email outreach</p><h1 className="mt-1 text-3xl font-semibold">Interested leads</h1><p className="mt-2 text-sm text-slate-600">Handle conversations in {GENERAL_INBOX}. Track ownership and the next follow-up here.</p></div><button className={button} disabled={loading} onClick={reload}>Refresh</button></header>
    <div className="flex flex-wrap items-end gap-4"><label className="text-sm font-medium">Stage<select className={field} value={filter} onChange={e=>{setFilter(e.target.value);setPage(0);setLoading(true);}}><option value="">All stages</option>{[...outreachLeadStages,'suppressed'].map(s=><option key={s} value={s}>{title(s)}</option>)}</select></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={dueOnly} onChange={e=>{setDueOnly(e.target.checked);setPage(0);setLoading(true);}}/>Due now or overdue</label><p className="pb-3 text-sm text-slate-500">{total} leads</p></div>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-4 text-red-800">{error}</p>}
    {loading&&<p role="status">Loading leads...</p>}
    {!loading&&!error&&!leads.length&&<div className="rounded-xl border border-dashed border-slate-300 p-10"><h2 className="font-semibold">No leads in this view</h2><p className="mt-2 text-sm text-slate-600">When Instantly classifies a prospect as interested, their ticket appears here.</p></div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,1fr)]"><section className="space-y-3" aria-label="Interested leads">{!error&&leads.map(lead=><button key={lead.id} onClick={()=>setSelected(lead)} aria-pressed={selected?.id===lead.id} className={`w-full rounded-xl border bg-white p-4 text-left ${selected?.id===lead.id?'border-blue-500 ring-1 ring-blue-300':'border-slate-200'}`}>
      <div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{lead.contact.company_name||lead.contact.email}</strong><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{title(lead.stage)}</span></div><p className="mt-1 break-all text-sm text-slate-500">{lead.contact.email}</p><p className="mt-3 text-xs text-slate-500">{campaignNames[lead.campaign.campaign_key]} · {lead.owner_email||'Unassigned'}</p><p className="mt-3 text-sm font-medium">{lead.next_action}</p><p className={`mt-1 text-xs ${lead.next_follow_up_at&&Date.parse(lead.next_follow_up_at)<=asOf?'font-semibold text-amber-800':'text-slate-500'}`}>Follow-up: {date(lead.next_follow_up_at)}</p>
    </button>)}</section>{selected?<LeadEditor key={`${selected.id}:${selected.version}`} lead={selected} onSaved={()=>{setSelected(null);reload();}}/>:<aside className="rounded-xl bg-slate-50 p-6 text-sm text-slate-500">Select a lead to review the reply, claim ownership and schedule the next action.</aside>}</div>
    <nav aria-label="Lead pages" className="flex items-center gap-3"><button className={button} disabled={loading||page===0} onClick={()=>{setPage(p=>p-1);setLoading(true);}}>Previous</button><span className="text-sm">Page {page+1}</span><button className={button} disabled={loading||(page+1)*50>=total} onClick={()=>{setPage(p=>p+1);setLoading(true);}}>Next</button></nav>
  </main>;
}
function LeadEditor({lead,onSaved}:{lead:StaffLead;onSaved:()=>void}) {
  const [stage,setStage]=useState<OutreachLeadStage>(lead.stage==='suppressed'?'lost':lead.stage);
  const [due,setDue]=useState(localDate(lead.next_follow_up_at));
  const [action,setAction]=useState(lead.next_action);
  const [note,setNote]=useState(lead.notes);
  const [claim,setClaim]=useState(!lead.owner_email);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [history,setHistory]=useState<History|null>(null);
  const [historyError,setHistoryError]=useState('');
  const suppressed=lead.stage==='suppressed';
  useEffect(()=>{const c=new AbortController();fetch(`/api/outreach/leads?id=${lead.id}`,{cache:'no-store',signal:c.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'History unavailable');if(!c.signal.aborted)setHistory(v);}).catch(e=>{if(!c.signal.aborted)setHistoryError(e.message);});return()=>c.abort();},[lead.id]);
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{
    const r=await fetch('/api/outreach/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:lead.id,version:lead.version,stage,due:due?new Date(due).toISOString():null,action,note,claim})});
    const v=await r.json();if(!r.ok)throw Error(v.error||'Unable to save');onSaved();
  }catch(e){setError(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}
  return <aside className="min-w-0 space-y-5 rounded-xl border border-slate-200 bg-white p-5"><div><h2 className="break-all text-xl font-semibold">{lead.contact.company_name||lead.contact.email}</h2><p className="mt-1 break-all text-sm text-slate-500">{lead.contact.email}</p><p className="mt-2 text-sm">Owner: {lead.owner_email||'Unassigned'}</p></div>
    {suppressed?<p role="status" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Do not contact. This lead has been suppressed.</p>:<form onSubmit={save} className="space-y-4"><label className="block text-sm font-medium">Stage<select className={field} value={stage} onChange={e=>setStage(e.target.value as OutreachLeadStage)}>{outreachLeadStages.map(s=><option key={s} value={s}>{title(s)}</option>)}</select></label><label className="block text-sm font-medium">Next action<input required={!['won','lost'].includes(stage)} minLength={3} maxLength={1000} className={field} value={action} onChange={e=>setAction(e.target.value)}/></label><label className="block text-sm font-medium">Follow-up date and time<input type="datetime-local" required={!['won','lost'].includes(stage)} className={field} value={due} onChange={e=>setDue(e.target.value)}/></label><label className="block text-sm font-medium">Notes<textarea rows={4} maxLength={4000} className={field} value={note} onChange={e=>setNote(e.target.value)}/></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={claim} onChange={e=>setClaim(e.target.checked)}/>Assign this lead to me</label><p className="text-xs text-slate-500">Reply in the general inbox, then record the outcome and next follow-up here. Saving creates no outgoing email. Staff replies sync from the general inbox when connected.</p>{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}<button className={`${button} w-full`} disabled={busy}>{busy?'Saving...':'Save lead'}</button></form>}
    <section><h3 className="font-semibold">Conversation</h3><p className="mt-1 text-xs text-slate-500">Inbox last checked: {date(lead.mail_synced_at)}</p>{lead.mail_sync_error&&<p role="status" className="mt-2 text-sm text-amber-800">{lead.mail_sync_error}</p>}{history?.mail?.map(m=><article key={m.id} className="mt-3 rounded-lg bg-blue-50 p-3"><p className="text-xs text-slate-500">{m.direction==='outbound'?'Team reply':'Prospect reply'} · {date(m.received_at)}</p><p className="mt-1 text-sm font-medium">{m.subject}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p></article>)}{historyError&&<p role="alert" className="mt-2 text-sm text-red-700">{historyError}</p>}{!history&&!historyError&&<p className="mt-2 text-sm">Loading conversation...</p>}{history?.events.filter(e=>e.event_type!=='email_sent').map(e=><article key={e.id} className="mt-3 rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-500">{title(e.event_type)} · {date(e.occurred_at)}</p>{e.event.subject&&<p className="mt-1 text-sm font-medium">{e.event.subject}</p>}<p className="mt-2 whitespace-pre-wrap break-words text-sm">{e.event.body||'Open the original conversation in the general inbox to read this message.'}</p>{e.event.body&&!e.event.bodyComplete&&<p className="mt-2 text-xs text-amber-800">Preview only. Review the full email in the inbox.</p>}</article>)}</section>
    <section><h3 className="font-semibold">Staff activity</h3>{history?.audit.map(a=><article key={a.id} className="mt-3 border-t pt-3 text-sm"><p>{title(a.action)} · {a.actor_email}</p><p className="text-xs text-slate-500">{date(a.created_at)}</p><p className="mt-1 whitespace-pre-wrap">{a.detail.nextAction}</p><p className="mt-1 whitespace-pre-wrap">{a.detail.note}</p></article>)}</section>
  </aside>;
}
