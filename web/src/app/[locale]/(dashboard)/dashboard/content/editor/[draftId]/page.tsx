'use client';

import { useParams } from 'next/navigation';
import { ContentEditorSurface } from './_editor-surface';

/**
 * A draft in the editor (Content Editor, CE-004), opened from the Library.
 * Full height, as Chat is: the editor scrolls inside, under its header. The
 * page and the side panel scroll on their own; the window and the dashboard
 * around them never do. Relative and clipped top to bottom: nothing in the
 * editor can make the page taller than the screen (the owner, 2026-11-14).
 * Not clipped sideways: a narrow window still scrolls across, as before.
 */
export default function ContentEditorPage() {
  const { draftId } = useParams<{ draftId: string }>();
  return (
    <div className="relative -m-6 flex h-[calc(100%+3rem)] flex-col overflow-y-clip">
      <ContentEditorSurface draftId={draftId} />
    </div>
  );
}
