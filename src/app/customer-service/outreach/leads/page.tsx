import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/admin-auth';
import OutreachLeadsDashboard from '@/components/admin/OutreachLeadsDashboard';
export const metadata = { title: 'Outreach leads | RF Tools', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';
export default async function Page() {
  if (!(await isAuthenticated())) redirect('/login');
  return <OutreachLeadsDashboard />;
}
