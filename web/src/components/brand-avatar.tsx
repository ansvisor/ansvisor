'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getFaviconUrl } from '@/lib/favicon';
import { cn } from '@/lib/utils';

// ─── Pure helpers — exported so tests import the real implementations ─────────

/**
 * Derives up to two initials from a brand name.
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Returns the primary domain string from a domains array, or undefined.
 */
export function getPrimaryDomain(
  domains: { domain: string; isPrimary: boolean }[] | undefined,
): string | undefined {
  return domains?.find((d) => d.isPrimary)?.domain;
}

export type Stage = 'manual' | 'google' | 'ico' | 'fallback';

/**
 * Resolves the initial fallback stage from the available props.
 * logo_url should be null/undefined for new brands — derived favicon URLs
 * must not be stored, so this function sees an empty field for most brands.
 */
export function resolveInitialStage(
  logoUrl: string | undefined,
  primaryDomain: string | undefined,
): Stage {
  if (logoUrl) return 'manual';
  if (primaryDomain) return 'google';
  return 'fallback';
}

/**
 * Returns the image src for a given stage.
 */
export function resolveUrl(
  stage: Stage,
  logoUrl: string | undefined,
  primaryDomain: string | undefined,
): string | undefined {
  if (stage === 'manual') return logoUrl;
  if (stage === 'google') return primaryDomain ? getFaviconUrl(primaryDomain) : undefined;
  if (stage === 'ico') return primaryDomain ? `https://${primaryDomain}/favicon.ico` : undefined;
  return undefined;
}

/**
 * Moves to the next stage in the fallback chain.
 *
 * Chain: manual → google → ico → fallback
 */
export function advance(current: Stage, primaryDomain: string | undefined): Stage {
  if (current === 'manual') return primaryDomain ? 'google' : 'fallback';
  if (current === 'google') return primaryDomain ? 'ico' : 'fallback';
  return 'fallback';
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Fallback chain:
 *   1. manual logoUrl  (if set by user)
 *   2. Google favicon  (advances if naturalWidth ≤ 16 — grey-globe placeholder)
 *   3. /favicon.ico    (direct fetch from primary domain)
 *   4. Initials        (AvatarFallback — always available)
 *
 * Uses Base UI's onLoadingStatusChange (not onError on the <img>) because
 * AvatarImage preloads with new Image() and unmounts the <img> on error,
 * so the two handlers would race on the same request.
 */

interface BrandAvatarProps {
  logoUrl?: string;
  name: string;
  domains?: { domain: string; isPrimary: boolean }[];
  primaryDomain?: string;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}

function BrandAvatarInner({
  logoUrl,
  name,
  primaryDomain,
  initialStage,
  className,
  imageClassName,
  fallbackClassName,
}: {
  logoUrl?: string;
  name: string;
  primaryDomain?: string;
  initialStage: Stage;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
}) {
  const [stage, setStage] = useState<Stage>(initialStage);

  const src = resolveUrl(stage, logoUrl, primaryDomain);

  function handleAdvance() {
    setStage((current) => advance(current, primaryDomain));
  }

  /**
   * Base UI fires onLoadingStatusChange with status values:
   *   'loading' | 'loaded' | 'error'
   *
   * When status === 'loaded', check naturalWidth to catch the grey-globe.
   * When status === 'error', advance immediately.
   */
  function handleLoadingStatusChange(status: string, e?: React.SyntheticEvent<HTMLImageElement>) {
    if (status === 'error') {
      handleAdvance();
    } else if (status === 'loaded' && stage === 'google') {
      const img = e?.currentTarget;
      if (img && img.naturalWidth <= 16) {
        handleAdvance();
      }
    }
  }

  const initials = getInitials(name);

  return (
    <Avatar className={className}>
      {src && (
        <AvatarImage
          key={src}
          src={src}
          alt={name}
          onLoadingStatusChange={handleLoadingStatusChange}
          className={cn('object-contain p-0.5', imageClassName)}
        />
      )}
      <AvatarFallback
        className={cn(
          'rounded-md bg-primary text-primary-foreground text-xs font-semibold',
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export function BrandAvatar({
  logoUrl,
  name,
  domains,
  primaryDomain: primaryDomainProp,
  className,
  imageClassName,
  fallbackClassName,
}: BrandAvatarProps) {
  const primaryDomain = primaryDomainProp ?? getPrimaryDomain(domains);
  const initialStage = resolveInitialStage(logoUrl, primaryDomain);
  const resetKey = `${logoUrl ?? ''}|${primaryDomain ?? ''}`;

  return (
    <BrandAvatarInner
      key={resetKey}
      logoUrl={logoUrl}
      name={name}
      primaryDomain={primaryDomain}
      initialStage={initialStage}
      className={className}
      imageClassName={imageClassName}
      fallbackClassName={fallbackClassName}
    />
  );
}
