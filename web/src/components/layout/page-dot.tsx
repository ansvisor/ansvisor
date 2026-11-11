'use client';

import { useTranslations } from 'next-intl';
import { MenuDot } from '@/components/layout/menu-dot';
import type { PageDotFact } from '@/lib/page-dots';

/**
 * A page's own dot, beside a row's or a tab's title: the menu's dot
 * (MenuDot, the same look and words) with why it is lit, "Needs you:
 * waiting for approval", on hover and to screen readers. Nothing without a dot.
 */
export function PageDot({ dot, className }: { dot: PageDotFact | null; className?: string }) {
  const t = useTranslations('pageDots.reasons');
  if (!dot) return null;
  return (
    <MenuDot
      dot={{ colour: dot.colour }}
      why={t(dot.reason, dot.values ?? {})}
      className={className}
    />
  );
}
