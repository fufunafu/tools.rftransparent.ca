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
  return <section aria-label="Direct Instantly status" className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1"><h2 className="font-semibold text-slate-700">Instantly</h2>
    {error?<p role="alert" className="text-amber-900">{error}</p>:!visible?.length?<p role="status" className="text-slate-500">Checking Instantly...</p>:visible.filter(row=>row.interested>0||row.uniqueReplies!==null||campaign).map(row=><div key={row.campaignKey} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {visible.length>1&&<span className="text-slate-500">{campaignNames[row.campaignKey]}</span>}
      <span><strong>{row.inRfTools}/{row.interested}</strong> interested contacts in RF Tools</span>
      {row.waiting.length>0?<details role="status" className="text-amber-900"><summary className="cursor-pointer">{row.waiting.length} interested {row.waiting.length===1?'contact is':'contacts are'} not in RF Tools yet.</summary><ul className="mt-2">{row.waiting.map(contact=><li key={contact.email}>{contact.company} ({contact.email})</li>)}</ul></details>:<span className="text-emerald-700">All synced</span>}
    </div>)}</div>
    {!error&&visible&&<details className="mt-1 text-slate-500"><summary className="cursor-pointer">Campaign statistics</summary>
      <p className="mt-2">Refreshed every minute. Filters affect the lead list only. Analytics totals can differ from current Interested status.</p>
      {visible.map(row=><div key={row.campaignKey} className="mt-2"><p className="font-medium">{campaignNames[row.campaignKey]}</p><dl className="flex flex-wrap gap-x-5 gap-y-1">{[['Unique replies',row.uniqueReplies],['Opportunities',row.opportunities],['Currently interested',row.interested],['Interested in RF Tools',row.inRfTools]].map(([label,value])=><div key={String(label)} className="flex gap-1"><dt>{label}:</dt><dd className="font-medium">{value??'Not available'}</dd></div>)}</dl><p>Checked {new Date(row.checkedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</p></div>)}
    </details>}
  </section>;
}
