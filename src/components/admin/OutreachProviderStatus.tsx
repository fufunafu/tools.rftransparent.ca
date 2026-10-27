'use client';
import { useEffect,useState } from 'react';
import { campaignNames,type CampaignKey } from '@/lib/outreach/types';
interface Status {campaignKey:CampaignKey;checkedAt:string;uniqueReplies:number|null;opportunities:number|null;interested:number;inRfTools:number;waiting:{email:string;company:string}[]}
export default function OutreachProviderStatus({campaign,refresh}:{campaign:string;refresh:number}){
  const [data,setData]=useState<{scope:string;rows:Status[]}|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch(`/api/outreach/leads/provider-status?${new URLSearchParams({campaign})}`,{cache:'no-store',signal:controller.signal})
      .then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'Instantly is unavailable');return result;})
      .then(result=>{if(!controller.signal.aborted){setData({scope:campaign,rows:result.campaigns});setError('');}})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[campaign,refresh]);
  // Hide a previous campaign's values while the selected campaign loads.
  const visible=data?.scope===campaign?data.rows:null;
  return <section aria-label="Direct Instantly status" className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 sm:p-5">
    <h2 className="font-semibold text-slate-900">Direct from Instantly</h2>
    <p className="mt-1 text-xs text-slate-600">Campaign totals, refreshed every minute. Search, owner and stage filters only affect the RF Tools list below.</p>
    {error?<p role="alert" className="mt-3 text-sm text-amber-900">{error}</p>:!visible?.length?<p role="status" className="mt-3 text-sm text-slate-500">Checking Instantly...</p>:visible.map(row=><div key={row.campaignKey} className="mt-4 border-t border-blue-100 pt-4">
      <div className="flex flex-wrap justify-between gap-2"><h3 className="text-sm font-semibold">{campaignNames[row.campaignKey]}</h3><p className="text-xs text-slate-500">Checked {new Date(row.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</p></div>
      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{[['Unique replies',row.uniqueReplies],['Opportunities',row.opportunities],['Currently interested',row.interested],['Interested in RF Tools',row.inRfTools]].map(([label,value])=><div key={String(label)}><dt className="text-xs text-slate-600">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value??'Not available'}</dd></div>)}</dl>
      {row.uniqueReplies===null&&<p className="mt-2 text-xs text-slate-500">Instantly has not returned analytics for this campaign yet.</p>}
      {row.waiting.length>0?<div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-medium">{row.waiting.length} interested {row.waiting.length===1?'contact is':'contacts are'} not in RF Tools yet.</p><p className="mt-1">The list below is incomplete until these contacts sync.</p><details className="mt-2"><summary className="cursor-pointer font-medium">View contacts awaiting sync</summary><ul className="mt-2 space-y-1">{row.waiting.map(contact=><li key={contact.email} className="break-words">{contact.company} <span className="text-xs">({contact.email})</span></li>)}</ul></details></div>:<p className="mt-3 text-xs text-emerald-800">All contacts currently marked Interested are represented in RF Tools.</p>}
    </div>)}
    <p className="mt-4 text-xs text-slate-500">Unique replies and opportunities are Instantly analytics totals. Currently interested is the live lead status, so these numbers can differ.</p>
  </section>;
}
