import type { Metadata } from 'next';

export function buildMetadata({
  title,
  description,
  url,
  image,
}: {
  title?: string;
  description?: string;
  url?: string;
  image?: string;
}): Metadata {
  const site = 'Optumus Analytics';
  const base = process.env.NEXT_PUBLIC_APP_URL || 'https://app.optumusanalytics.com';

  return {
    title: title ? `${title} | ${site}` : site,
    description: description ?? 'AI Search & LLM Visibility',
    metadataBase: new URL(base),
    openGraph: {
      title: title ?? site,
      description: description ?? 'AI Search & LLM Visibility',
      url: url ?? base,
      siteName: site,
      type: 'website',
      images: image ? [image] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: title ?? site,
      description: description ?? 'AI Search & LLM Visibility',
    },
  } as Metadata;
}

export default buildMetadata;
