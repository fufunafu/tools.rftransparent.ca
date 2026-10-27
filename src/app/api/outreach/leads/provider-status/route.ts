import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { getOutreachConfig } from '@/lib/outreach/domain';
import { getProviderSnapshot } from '@/lib/outreach/provider-status';
import type { CampaignKey } from '@/lib/outreach/types';
export const dynamic='force-dynamic';
export const maxDuration=120;
const headers={'Cache-Control':'private, no-store'};
export async function GET(request:Request){
  const user=await getAuthenticatedUser();
  if(!user?.email)return NextResponse.json({error:'Unauthorized'},{status:401,headers});
  const campaign=new URL(request.url).searchParams.get('campaign')||'';
  if(!['','materials_sales','installer_network'].includes(campaign))return NextResponse.json({error:'Invalid campaign'},{status:400,headers});
  const config=getOutreachConfig(),key=process.env.INSTANTLY_API_KEY;
  if(!config || !key)return NextResponse.json({error:'Instantly connection is not configured.'},{status:503,headers});
  const campaigns=campaign?[campaign as CampaignKey]:['materials_sales','installer_network'] as CampaignKey[];
  try{
    const results=await Promise.all(campaigns.map(async campaignKey=>{
      const provider=await getProviderSnapshot(config.workspaceId,config.campaignIds[campaignKey],key);
      const synced=new Set<string>();
      // Check only the interested contacts, in bounded chunks, including closed
      // and suppressed tickets so they are not incorrectly labelled missing.
      for(let i=0;i<provider.interested.length;i+=100){
        const emails=provider.interested.slice(i,i+100).map(x=>x.email);
        const {data,error}=await getSupabase().from('outreach_leads')
          .select('contact:outreach_contacts!inner(email),campaign:outreach_cases!inner(campaign_key)')
          .eq('campaign.campaign_key',campaignKey).in('contact.email',emails);
        if(error)throw Error('RF Tools comparison unavailable');
        for(const row of data??[]){
          const contact=row.contact as unknown as {email:string};synced.add(contact.email.toLowerCase());
        }
      }
      const waiting=provider.interested.filter(x=>!synced.has(x.email));
      return {campaignKey,checkedAt:provider.checkedAt,uniqueReplies:provider.uniqueReplies,opportunities:provider.opportunities,
        interested:provider.interested.length,inRfTools:provider.interested.length-waiting.length,waiting};
    }));
    return NextResponse.json({campaigns:results},{headers});
  }catch{return NextResponse.json({error:'Unable to check Instantly right now. The RF Tools list may be incomplete. Try Refresh.'},{status:503,headers});}
}
