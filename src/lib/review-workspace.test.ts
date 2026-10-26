import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoDataConfiguration, hasReviewProxyAccess, isDemoWorkspace, isReviewUser, reviewWorkspaceTarget } from './review-workspace';
afterEach(() => vi.unstubAllEnvs());
describe('isolated review workspace', () => {
 it('is off without explicit deployment configuration', () => { expect(isDemoWorkspace()).toBe(false); expect(isReviewUser({id:'untrusted'})).toBe(false); });
 it('requires the exact configured authenticated identity', () => { vi.stubEnv('RF_REVIEW_USER_ID','review-id'); expect(isReviewUser(null)).toBe(false); expect(isReviewUser({id:'different'})).toBe(false); expect(isReviewUser({id:'review-id'})).toBe(true); });
 it('requires a strong matching proxy secret', () => { vi.stubEnv('RF_REVIEW_PROXY_SECRET','s'.repeat(40)); expect(hasReviewProxyAccess(null)).toBe(false); expect(hasReviewProxyAccess('s'.repeat(39))).toBe(false); expect(hasReviewProxyAccess('x'.repeat(40))).toBe(false); expect(hasReviewProxyAccess('s'.repeat(40))).toBe(true); vi.stubEnv('RF_REVIEW_PROXY_SECRET','short'); expect(hasReviewProxyAccess('short')).toBe(false); });
 it.each(['http://demo.vercel.app','https://evil.example','https://demo.vercel.app@evil.example','https://demo.vercel.app/path','https://demo.vercel.app?x=1'])('rejects an unsafe proxy destination %s',(origin)=>{vi.stubEnv('RF_REVIEW_ORIGIN',origin);expect(()=>reviewWorkspaceTarget(new URL('https://tools.rftransparent.ca/todos'))).toThrow();});
 it('preserves the requested route and query on a trusted destination',()=>{vi.stubEnv('RF_REVIEW_ORIGIN','https://demo.vercel.app');expect(reviewWorkspaceTarget(new URL('https://tools.rftransparent.ca/todos?q=sample')).href).toBe('https://demo.vercel.app/todos?q=sample');});
 it('never falls back to live data when demo configuration is incomplete',()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://live.supabase.co');expect(()=>demoDataConfiguration()).toThrow();});
 it('requires the exact configured isolated project',()=>{vi.stubEnv('RF_REVIEW_DATA_PROJECT','demo');vi.stubEnv('RF_REVIEW_DATA_URL','https://live.supabase.co');vi.stubEnv('RF_REVIEW_DATA_KEY','demo-secret');expect(()=>demoDataConfiguration()).toThrow();vi.stubEnv('RF_REVIEW_DATA_URL','https://demo.supabase.co');expect(demoDataConfiguration().url).toBe('https://demo.supabase.co');});
});
