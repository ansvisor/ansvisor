'use client';

import { useParams } from 'next/navigation';
import { ContentEditorSurface } from './_editor-surface';

/**
 * A draft in the editor (Content Editor, CE-004), opened from the Library.
 * Full height, as Chat is: the editor scrolls inside, under its header.
 */
export default function ContentEditorPage() {
  const { draftId } = useParams<{ draftId: string }>();
  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col md:h-screen">
      <ContentEditorSurface draftId={draftId} />
    </div>
  );
}
