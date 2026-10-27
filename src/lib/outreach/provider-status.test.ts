import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {getProviderSnapshot} from './provider-status';
const lead=(email:string,campaign:string)=>({id:email,email,organization:'workspace',campaign,lt_interest_status:1,company_name:'Builder'});
it('keeps analytics and current interest distinct, paginates and deduplicates contacts, and caches reads',async()=>{
 const campaign='pagination';
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json([{campaign_id:campaign,reply_count_unique:6,total_opportunities:4}]))
  .mockResolvedValueOnce(Response.json({items:[lead('one@example.com',campaign)],next_starting_after:'page2'}))
  .mockResolvedValueOnce(Response.json({items:[lead('one@example.com',campaign),lead('two@example.com',campaign)]}));
 const result=await getProviderSnapshot('workspace',campaign,'secret',fetcher);
 expect(result).toMatchObject({uniqueReplies:6,opportunities:4,interested:[{email:'one@example.com'},{email:'two@example.com'}]});
 expect(JSON.parse(fetcher.mock.calls[2][1].body).starting_after).toBe('page2');
 expect(await getProviderSnapshot('workspace',campaign,'secret',fetcher)).toEqual(result);expect(fetcher).toHaveBeenCalledTimes(3);
 expect(JSON.stringify(result)).not.toContain('secret');
});
it('rejects cross-workspace leads instead of displaying misleading totals',async()=>{
 const campaign='mismatch';const fetcher=vi.fn().mockResolvedValueOnce(Response.json([{campaign_id:campaign,reply_count_unique:1,total_opportunities:1}]))
 .mockResolvedValueOnce(Response.json({items:[{...lead('one@example.com',campaign),organization:'other'}]}));
 await expect(getProviderSnapshot('workspace',campaign,'key',fetcher)).rejects.toThrow('Lead identity mismatch');
});
it('rejects repeated pagination cursors rather than claiming a complete count',async()=>{
 const campaign='repeated';const fetcher=vi.fn().mockResolvedValueOnce(Response.json([{campaign_id:campaign,reply_count_unique:1,total_opportunities:1}]))
 .mockImplementation(async()=>Response.json({items:[],next_starting_after:'same'}));
 await expect(getProviderSnapshot('workspace',campaign,'key',fetcher)).rejects.toThrow('Incomplete');
});
it('does not convert a provider failure into zero replies',async()=>{
 await expect(getProviderSnapshot('workspace','failure','key',vi.fn().mockResolvedValue(new Response('secret',{status:503})))).rejects.toThrow();
});
it('keeps an inactive campaign with no analytics from hiding the active campaign',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json([])).mockResolvedValueOnce(Response.json({items:[]}));
 expect(await getProviderSnapshot('workspace','inactive','key',fetcher)).toMatchObject({uniqueReplies:null,opportunities:null,interested:[]});
});
