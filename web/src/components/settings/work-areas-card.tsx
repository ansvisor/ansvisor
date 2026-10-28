'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useRouter } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/use-user-role';
import { cn } from '@/lib/utils';
import { dashboardNav } from '@/config/dashboard';
import { getDashboardNavLabel } from '@/lib/dashboard-navigation';
import {
  MENU_SECTIONS,
  WORK_AREA_IDS,
  hiddenMenuSections,
  menuSectionOf,
  type WorkAreaId,
} from '@/lib/menu-access';
import { getMyMenu, setMyWorkAreas, type MyMenu } from '@/lib/actions/menu-access';

/** The menu's sections with their icons and nav titles, in its order. */
const SECTIONS = dashboardNav
  .flatMap((group) => group.items)
  .flatMap((item) => {
    const section = menuSectionOf(item.href);
    return section ? [{ section, title: item.title, icon: item.icon }] : [];
  });

/**
 * The menu with other work areas: what the admin takes off stays off, and the
 * areas narrow the rest (as for anyone, admins included).
 */
export function menuWithWorkAreas(menu: MyMenu, workAreas: WorkAreaId[]): MyMenu {
  const byAreas = hiddenMenuSections({
    role: 'admin',
    roleHidden: [],
    shown: [],
    hidden: [],
    workAreas,
  });
  return {
    ...menu,
    workAreas,
    hidden: MENU_SECTIONS.filter((s) => menu.hiddenByAdmin.includes(s) || byAreas.has(s)),
  };
}

/**
 * Settings › Account › Your work areas: what the person works on or leads,
 * which narrows their own left menu (menu access, 00374), and the menu it
 * leaves them, with why a section is off. Saved as it changes.
 */
export function WorkAreasCard() {
  const t = useTranslations('settings.menuAccess');
  const tNav = useTranslations('nav');
  const { canAdmin } = useUserRole();
  const router = useRouter();
  const [menu, setMenu] = useState<MyMenu | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    getMyMenu().then(
      (next) => {
        if (current) setMenu(next);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  const save = async (workAreas: WorkAreaId[]) => {
    if (!menu) return;
    const before = menu;
    setMenu(menuWithWorkAreas(menu, workAreas));
    try {
      await setMyWorkAreas(workAreas);
      router.refresh();
    } catch {
      setMenu(before);
      toast.error(t('saveFailed'));
    }
  };

  const toggle = (area: WorkAreaId) => {
    if (!menu) return;
    const picked = menu.workAreas.includes(area)
      ? menu.workAreas.filter((a) => a !== area)
      : [...menu.workAreas, area];
    void save(WORK_AREA_IDS.filter((a) => picked.includes(a)));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('workAreasTitle')}</CardTitle>
        <CardDescription>
          {canAdmin ? t('workAreasDescriptionAdmin') : t('workAreasDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
        ) : !menu ? (
          <div className="space-y-2">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {WORK_AREA_IDS.map((area) => {
                const on = menu.workAreas.includes(area);
                return (
                  <Button
                    key={area}
                    variant={on ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={on}
                    title={t(`areas.${area}.text`)}
                    className="h-7 rounded-full px-3 text-xs"
                    onClick={() => toggle(area)}
                  >
                    {t(`areas.${area}.title`)}
                  </Button>
                );
              })}
              <Button
                variant={menu.workAreas.length ? 'outline' : 'default'}
                size="sm"
                aria-pressed={!menu.workAreas.length}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => void save([])}
              >
                {t('everything')}
              </Button>
            </div>

            <div className="@container">
              <p className="mb-2 flex items-baseline gap-2 text-sm font-medium">
                {t('yourMenu')}
                <span className="text-xs font-normal text-muted-foreground">
                  {t('sectionCount', {
                    count: MENU_SECTIONS.length - menu.hidden.length,
                    total: MENU_SECTIONS.length,
                  })}
                </span>
              </p>
              {/* Two columns once a section and why it's off fit side by side. */}
              <ul className="grid grid-cols-1 gap-x-6 gap-y-1.5 @lg:grid-cols-2">
                {SECTIONS.map(({ section, title, icon: Icon }) => {
                  const off = menu.hidden.includes(section);
                  const byAdmin = menu.hiddenByAdmin.includes(section);
                  return (
                    <li
                      key={section}
                      data-section={section}
                      className={cn('flex items-center gap-2 text-sm', off && 'opacity-50')}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{getDashboardNavLabel(title, tNav)}</span>
                      {off && (
                        <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          {byAdmin && <Lock className="h-3 w-3" />}
                          {byAdmin ? t('hiddenByAdmin') : t('notInWorkAreas')}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {menu.hiddenByAdmin.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{t('adminTookOff', { count: menu.hiddenByAdmin.length })}</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
