import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/admin-auth';
import { getSupabase } from '@/lib/supabase';
import { readLimitedJson } from '@/lib/outreach/http';
import { OutreachInputError } from '@/lib/outreach/domain';
import { callResults, safeQuoteLink } from '@/lib/outreach/staff-leads';
import { outreachStaffIdentity } from '@/lib/outreach/staff-identity';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const common = {
  id:z.string().uuid(),version:z.number().int().positive(),requestId:z.string().uuid(),
  at:z.string().datetime({offset:true}).refine(v=>Date.parse(v)>=Date.parse('2000-01-01') && Date.parse(v)<=Date.now()+300000),
  note:z.string().trim().max(4000),
};
const followUp = {due:z.string().datetime({offset:true}),action:z.string().trim().min(3).max(1000)};
const input = z.discriminatedUnion('kind',[
  z.object({...common,...followUp,kind:z.literal('call'),result:z.enum(callResults)}),
  z.object({...common,...followUp,kind:z.literal('quote'),reference:z.string().trim().min(1).max(120),
    amount:z.number().finite().nonnegative().max(999999999999.99).multipleOf(0.01).nullable(),currency:z.enum(['USD','CAD']),
    url:z.string().trim().max(2000).refine(v=>!v||Boolean(safeQuoteLink(v))),
  }),
  z.object({...common,kind:z.literal('note'),note:z.string().trim().min(1).max(4000)}),
]);
export async function POST(request:Request) {
  const user=await getAuthenticatedUser();
  if(!user?.email)return NextResponse.json({error:'Unauthorized'},{status:401,headers});
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)return NextResponse.json({error:'Origin not allowed'},{status:403,headers});
  try {
    const parsed=input.safeParse(await readLimitedJson(request,12000));
    if(!parsed.success)return NextResponse.json({error:'Check the activity details, date and next follow-up.'},{status:400,headers});
    const v=parsed.data,actor=await outreachStaffIdentity(user.email);
    const result=await getSupabase().rpc('outreach_lead_log_activity',{
      p_id:v.id,p_version:v.version,p_request_id:v.requestId,p_actor:actor.email,p_actor_name:actor.name,
      p_kind:v.kind,p_at:v.at,p_note:v.note,p_call_result:v.kind==='call'?v.result:null,
      p_quote_number:v.kind==='quote'?v.reference:null,p_quote_amount:v.kind==='quote'?v.amount:null,
      p_quote_currency:v.kind==='quote'?v.currency:null,p_quote_url:v.kind==='quote'?(v.url||null):null,
      p_due:v.kind==='note'?null:v.due,p_action:v.kind==='note'?null:v.action,
    });
    if(result.error)return NextResponse.json({error:'Lead changed, is closed, or cannot be contacted. Refresh before recording this activity.'},{status:409,headers});
    return NextResponse.json({saved:true},{headers});
  }catch(error){return NextResponse.json({error:'Unable to record activity'},{status:error instanceof OutreachInputError?error.status:503,headers});}
}
