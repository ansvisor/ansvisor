import { redirect } from 'next/navigation';
import { actionRefNo } from '@/lib/action-center/action-ref';
import { createClient } from '@/lib/supabase/server';

/**
 * One action, by its id or by its number ("AC-1497"): the Actions page with
 * its drawer open (`?action=`), on the action's own brand (`&brand=`) and
 * with no filter, so the drawer opens whatever brand or filter was on before.
 * Chat's Open in Actions links here (CHAT-09 item 19): a link Chat shows is a
 * path in the app, without a query. So does an "AC-1497" in a Chat answer.
 * The lookup reads with the person's own access, so a number finds only an
 * action of their own workspace. An action the person can't read, or a number
 * with no action, opens the list.
 */
export default async function ActionRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const no = actionRefNo(id);
  const supabase = await createClient();
  const actions = supabase.from('actions').select('id, brand_id');
  const { data } = await (
    no === null ? actions.eq('id', id) : actions.eq('action_no', no)
  ).maybeSingle();
  const brandId = (data?.brand_id as string | undefined) ?? null;
  const actionId = no === null ? id : ((data?.id as string | undefined) ?? null);
  if (!brandId || !actionId) redirect('/dashboard/action-center/actions');
  redirect(
    `/dashboard/action-center/actions?action=${encodeURIComponent(actionId)}&brand=${encodeURIComponent(brandId)}`,
  );
}
