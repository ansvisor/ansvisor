import type { ReactNode } from 'react';
import { BrandVisibilityShellView } from '@/components/brand-visibility/shell';

/**
 * Brand Visibility (the owner's mockup): Overview (/dashboard/insights),
 * Mentions (/dashboard/mentions) and Citations (/dashboard/citations), one
 * route each under this layout. The header, the run line and the tabs are
 * drawn here and stay mounted from tab to tab; only the tab's own segment
 * renders, with its own loading.tsx and error.tsx, so a tab loads only its
 * own data, only when opened, and one tab's failure leaves the others be.
 * A result's page (insights/[id]) and a cited URL's (citations/url) are
 * outside the group: they keep their own headers.
 */
export default function BrandVisibilityLayout({ children }: { children: ReactNode }) {
  return <BrandVisibilityShellView>{children}</BrandVisibilityShellView>;
}
