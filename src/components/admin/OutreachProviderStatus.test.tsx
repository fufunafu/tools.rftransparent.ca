// @vitest-environment happy-dom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import OutreachProviderStatus from './OutreachProviderStatus';
let root:Root,container:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});
it('shows the provider totals separately and names interested contacts missing from RF Tools',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({campaigns:[{campaignKey:'materials_sales',checkedAt:'2026-10-27T02:00:00Z',uniqueReplies:6,opportunities:4,interested:6,inRfTools:2,waiting:[{email:'waiting@example.com',company:'Waiting Builder'}]}]})));
 await act(async()=>root.render(<OutreachProviderStatus campaign="materials_sales" refresh={0}/>));
 expect([...container.querySelectorAll('dd')].map(x=>x.textContent)).toEqual(['6','4','6','2']);
 expect(container.textContent).toContain('1 interested contact is not in RF Tools yet');expect(container.textContent).toContain('Waiting Builder');
});
it('shows an explicit error instead of zero or cached counts after a failed refresh',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'Unable to check Instantly right now.'},{status:503})));
 await act(async()=>root.render(<OutreachProviderStatus campaign="" refresh={0}/>));
 expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to check Instantly');expect(container.querySelector('dd')).toBeNull();
});
