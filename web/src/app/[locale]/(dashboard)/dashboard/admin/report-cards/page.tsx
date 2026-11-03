import { notFound } from 'next/navigation';
import { isChatStaff } from '@/lib/chat/staff';
import { loadReportCardStats } from '@/lib/report-card/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ReportCardAdmin } from './_report-card-admin';

export const dynamic = 'force-dynamic';

/**
 * The free report card's admin view (REPORT-CARD §7): requests, cards,
 * cost against the month's budget and failures. Only for Ansvisor staff
 * (STAFF_EMAILS, lib/chat/staff.ts, as Chat's Debug view); for anyone
 * else, a customer's Admin too, the page isn't there. Not linked from the
 * menu.
 */
export default async function ReportCardAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isChatStaff(user)) notFound();
  const stats = await loadReportCardStats(supabaseAdmin);
  return <ReportCardAdmin stats={stats} />;
}
