'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { OpportunityDetail } from '@/components/content/opportunity-detail';
import { useChatPageContext } from '@/components/chat/panel/chat-panel-context';
import type { ContentOpportunity } from '@/types';

export default function ContentDetailPage() {
  const params = useParams();
  const id = params.id as string;
  // Chat's side panel sees the page (the owner's plan of 2026-11-16, step 9's detail pages): the
  // content opportunity it holds open by its id, with its title, once read.
  const [read, setRead] = useState<{ id: string; title: string } | null>(null);
  const onOpportunity = useCallback(
    (opportunity: ContentOpportunity) => setRead({ id: opportunity.id, title: opportunity.title }),
    [],
  );
  useChatPageContext(
    read?.id === id
      ? { pageName: read.title, view: { open: { ref: id, label: read.title } } }
      : null,
  );
  return <OpportunityDetail id={id} onOpportunity={onOpportunity} />;
}
