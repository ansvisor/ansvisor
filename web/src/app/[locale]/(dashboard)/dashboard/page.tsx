import { redirect } from 'next/navigation';
import { withJobId } from '@/config/home';
import { readMyHome } from '@/lib/my-home';

/**
 * Everyone starts on their home (config/home.ts): Brand Visibility's
 * Overview once the workspace has answers, else Prompts › Tracked Prompts,
 * or Action Center › Today when neither is on their menu. A first run's job
 * (?jobId=, from setup after purchase) opens Tracked Prompts and comes along
 * for TrackingJobHandoff.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string | string[] }>;
}) {
  const { jobId } = await searchParams;
  const job = typeof jobId === 'string' ? jobId : null;
  redirect(withJobId(await readMyHome({ firstRun: job !== null }), job));
}
