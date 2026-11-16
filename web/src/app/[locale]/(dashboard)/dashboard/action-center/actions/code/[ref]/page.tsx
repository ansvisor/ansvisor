import { redirect } from 'next/navigation';
import { actionCodeRefNo } from '@/lib/action-center/action-ref';
import { createClient } from '@/lib/supabase/server';

const LIST = '/dashboard/action-center/actions';

/**
 * A code as text names it ("AC-03" in a Chat answer, action-ref.ts): text
 * can't tell a brand's code (00534) from an old global number, so this never
 * guesses. The one action of the person's workspace with that brand number
 * or old number opens in its drawer, on its brand; with two or more, the
 * Actions list opens searched for the code, which lists each of them (its
 * search matches both). Read with the person's own access, so another
 * workspace's action is never found. The old path, actions/AC-1497, keeps
 * reading the old number only.
 */
export default async function ActionCodeRedirect({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const no = actionCodeRefNo(ref);
  if (no === null) redirect(LIST);
  const supabase = await createClient();
  const { data } = await supabase
    .from('actions')
    .select('id, brand_id')
    .or(`brand_no.eq.${no},action_no.eq.${no}`)
    .limit(3);
  const found = (data ?? []) as { id: string; brand_id: string }[];
  if (found.length === 1) {
    redirect(
      `${LIST}?action=${encodeURIComponent(found[0].id)}&brand=${encodeURIComponent(found[0].brand_id)}`,
    );
  }
  redirect(found.length > 1 ? `${LIST}?q=${encodeURIComponent(ref)}` : LIST);
}
