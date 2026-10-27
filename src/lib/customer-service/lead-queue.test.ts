import { expect, it } from 'vitest';
import type { Lead } from './leads';
import { compareLeadPriority, hasUnansweredReply, isFollowUpDue, leadMatchesOwner } from './lead-queue';
const lead = (id: string, overrides: Partial<Lead> = {}) => ({ id, submitted_at: '2026-10-01T12:00:00Z', outcome: 'new', call_status: 'not_called', ...overrides } as Lead);
it('prioritizes overdue follow-ups, unanswered replies, uncalled leads, then other work', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  const items = [lead('new'), lead('closed', { outcome: 'won', next_follow_up_at: '2026-10-01' }), lead('reply', { last_reply_at: '2026-10-26T12:00:00Z' }), lead('due', { next_follow_up_at: '2026-10-25T12:00:00Z' })];
  expect(items.sort((a, b) => compareLeadPriority(a, b, now)).map((item) => item.id)).toEqual(['due', 'reply', 'new', 'closed']);
  expect(isFollowUpDue(items[3], now)).toBe(false);
});
it('does not treat a prospect reply as unanswered after a newer staff reply', () => {
  expect(hasUnansweredReply(lead('one', { last_reply_at: '2026-10-26T12:00:00Z', last_staff_reply_at: '2026-10-26T13:00:00Z' }))).toBe(false);
});
it('matches the current account owner case-insensitively and keeps unassigned distinct', () => {
  expect(leadMatchesOwner(lead('one', { assigned_to: 'STAFF@example.com' }), 'mine', 'staff@example.com')).toBe(true);
  expect(leadMatchesOwner(lead('one'), 'mine', '')).toBe(false);
  expect(leadMatchesOwner(lead('one'), 'unassigned', '')).toBe(true);
});
