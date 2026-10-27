import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase',()=>({getSupabase:vi.fn()}));
import {staffMailDirection} from './staff-mail';
import type {GmailConversationMessage} from '@/lib/gmail';
const message:GmailConversationMessage={id:'m1',threadId:'t1',from:'',to:'',subject:'Project',receivedAt:'2026-10-23T12:00:00Z',body:'',automatic:false};
describe('staff inbox matching',()=>{
 it('recognizes the exact prospect address',()=>{expect(staffMailDirection({...message,from:'Customer <customer@example.com>'},'customer@example.com')).toBe('inbound');});
 it('recognizes general-inbox responses addressed to this prospect',()=>{expect(staffMailDirection({...message,from:'Team <info@glassrailingstore.com>',to:'Customer <customer@example.com>, cc@example.com'},'customer@example.com')).toBe('outbound');});
 it('excludes other senders, misleading display names and internal forwards',()=>{expect(staffMailDirection({...message,from:'info@glassrailingstore.com <attacker@example.com>',to:'customer@example.com'},'customer@example.com')).toBeNull();expect(staffMailDirection({...message,from:'info@glassrailingstore.com',to:'staff@example.com'},'customer@example.com')).toBeNull();});
});
