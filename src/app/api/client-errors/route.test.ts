import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { user, rpc } = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ getAuthenticatedUser: user }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ rpc }) }));
import { POST } from './route';
beforeEach(() => { user.mockResolvedValue({ id: 'employee-id' }); rpc.mockResolvedValue({ data: [{ allowed: true }], error: null }); });
const request = (body: unknown, origin = 'https://tools.rftransparent.ca') => new NextRequest('https://tools.rftransparent.ca/api/client-errors', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });
it('rejects anonymous and cross-origin error reports', async () => {
  expect((await POST(request({}, 'https://other.example'))).status).toBe(403);
  user.mockResolvedValue(null); expect((await POST(request({}))).status).toBe(401);
});
it('logs a redacted diagnostic and limits repeated reports', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect((await POST(request({ path: '/customer-service/leads/rf?email=person@example.com', name: 'TypeError', message: 'Failed for person@example.com' }))).status).toBe(204);
    expect(log.mock.calls.flat().join(' ')).not.toContain('person@example.com');
    rpc.mockResolvedValue({ data: [{ allowed: false }], error: null });
    expect((await POST(request({ path: '/customer-service/leads/rf', name: 'Error', message: 'failed' }))).status).toBe(429);
  } finally { log.mockRestore(); }
});
