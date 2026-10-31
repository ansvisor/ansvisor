import { redirect } from 'next/navigation';

/**
 * One action, by its id: the Actions page with its drawer open
 * (`?action=`). Chat's Open in Actions links here (CHAT-09 item 19): a link
 * Chat shows is a path in the app, without a query.
 */
export default async function ActionRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/action-center/actions?action=${encodeURIComponent(id)}`);
}
