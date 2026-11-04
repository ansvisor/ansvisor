'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { listBrandPeople, type BrandPeople } from '@/lib/actions/team';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Brand settings › People (BRAND-ACCESS §3.2, PR 13): who can see this
 * brand, the reverse of Settings › Team. Admins see why each person does
 * (All brands, or shared with them) and change it in Team.
 */
export function PeopleTab({ brandId }: { brandId: string }) {
  const t = useTranslations('brands.settings.people');
  const tRoles = useTranslations('settings');
  const [read, setRead] = useState<BrandPeople | null | 'failed'>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    listBrandPeople(brandId)
      .then((people) => live && setRead(people))
      .catch(() => live && setRead('failed'));
    return () => {
      live = false;
    };
  }, [brandId, version]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {read && read !== 'failed' && read.isDemo ? t('demoDescription') : t('description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {read === null ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : read === 'failed' ? (
          <div role="status" className="space-y-2 text-sm text-muted-foreground">
            <p>{t('loadError')}</p>
            <Button size="sm" variant="outline" onClick={() => setVersion((v) => v + 1)}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {t('count', { count: read.people.length })}
            </p>
            <ul className="divide-y rounded-lg border">
              {read.people.map((person) => (
                <li key={person.userId} className="flex items-center gap-3 px-3 py-2">
                  <Avatar size="sm">
                    <AvatarFallback>{initials(person.name || '?')}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{person.name}</span>
                      {person.isCurrentUser && (
                        <Badge variant="secondary" className="text-xs">
                          {tRoles('team_you')}
                        </Badge>
                      )}
                    </span>
                    {person.email && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {person.email}
                      </span>
                    )}
                  </span>
                  {person.access && (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {t(`access.${person.access}`)}
                    </span>
                  )}
                  <Badge variant="outline">{tRoles(`team_role_${person.role}`)}</Badge>
                </li>
              ))}
            </ul>
            {read.isAdmin && !read.isDemo && (
              <Link
                href="/dashboard/settings/team"
                className="inline-flex items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
              >
                {t('editInTeam')}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
