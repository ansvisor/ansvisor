'use client';

import { useParams } from 'next/navigation';
import { OpportunityDetail } from '@/components/content/opportunity-detail';

export default function ContentDetailPage() {
  const params = useParams();
  return <OpportunityDetail id={params.id as string} />;
}
