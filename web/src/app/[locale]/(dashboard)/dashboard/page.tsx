import { redirect } from 'next/navigation';
import { withJobId } from '@/config/home';
import { readMyHome } from '@/lib/my-home';

/**
 * Everyone starts on their home (config/home.ts): Prompts › Tracked Prompts,
 * or Action Center › Today when Prompts is off their menu. A first run's job
 * (?jobId=, from setup after purchase) comes along for TrackingJobHandoff.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ jobId?: string | string[] }>;
}) {
  const { jobId } = await searchParams;
  redirect(withJobId(await readMyHome(), typeof jobId === 'string' ? jobId : null));
}
