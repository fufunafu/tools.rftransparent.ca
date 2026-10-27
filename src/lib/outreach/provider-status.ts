import 'server-only';
import { z } from 'zod';
import { getJson } from './instantly';

const count = z.number().int().nonnegative();
const analyticsSchema = z.array(z.object({ campaign_id:z.string(), reply_count_unique:count, total_opportunities:count }));
const leadSchema = z.object({ id:z.string(), email:z.string().email(), organization:z.string(), campaign:z.string(), company_name:z.string().nullable().optional(), lt_interest_status:z.literal(1) });
const pageSchema = z.object({items:z.array(leadSchema),next_starting_after:z.string().nullable().optional()});
export interface ProviderSnapshot {
  checkedAt:string; uniqueReplies:number|null; opportunities:number|null;
  interested:Array<{email:string;company:string}>;
}
const cached = new Map<string,{expires:number;data:ProviderSnapshot}>();
const pending = new Map<string,Promise<ProviderSnapshot>>();
// Cache provider reads for a minute across employees. No credentials or reply
// bodies are included in the returned data, cache key, or browser response.
export async function getProviderSnapshot(workspace:string,campaign:string,key:string,fetcher:typeof fetch=fetch):Promise<ProviderSnapshot> {
  const cacheKey=`${workspace}:${campaign}`;
  const existing=cached.get(cacheKey);
  if(existing && existing.expires>Date.now())return existing.data;
  const running=pending.get(cacheKey);if(running)return running;
  const request=(async()=>{
    const analytics=analyticsSchema.parse(await getJson(`campaigns/analytics?id=${encodeURIComponent(campaign)}`,key,fetcher));
    if(analytics.length>1 || (analytics.length===1 && analytics[0].campaign_id!==campaign))throw Error('Campaign analytics unavailable');
    const interested=new Map<string,{email:string;company:string}>();
    const cursors=new Set<string>();let cursor:string|undefined;
    for(let page=0;page<10;page++){
      const response=await fetcher('https://api.instantly.ai/api/v2/leads/list',{
        method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','User-Agent':'RF-Tools-Outreach/1.0'},
        body:JSON.stringify({campaign,filter:'FILTER_LEAD_INTERESTED',limit:100,...(cursor?{starting_after:cursor}:{})}),
        cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000),
      });
      if(!response.ok)throw Error('Interested leads unavailable');
      const result=pageSchema.parse(await response.json());
      for(const lead of result.items){
        if(lead.organization!==workspace || lead.campaign!==campaign)throw Error('Lead identity mismatch');
        const email=lead.email.toLowerCase();interested.set(email,{email,company:lead.company_name?.trim()||email});
      }
      if(!result.next_starting_after){
        const data={checkedAt:new Date().toISOString(),uniqueReplies:analytics[0]?.reply_count_unique??null,opportunities:analytics[0]?.total_opportunities??null,interested:[...interested.values()]};
        cached.set(cacheKey,{expires:Date.now()+60000,data});return data;
      }
      cursor=result.next_starting_after;
      if(cursors.has(cursor))throw Error('Incomplete interested lead list');cursors.add(cursor);
    }
    throw Error('Interested lead list exceeds current read limit');
  })();
  pending.set(cacheKey,request);
  try{return await request;}finally{pending.delete(cacheKey);}
}
