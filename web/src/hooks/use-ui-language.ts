'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import type { AnyUiLocale } from '@/i18n/locales';
import { getUiLanguageState, setUiLanguage, type UiLanguageState } from '@/lib/actions/ui-language';

/**
 * The person's interface language and the way to change it (LOC-005), for
 * Settings › Language and the account menu. Read once `enabled`; `pick`
 * saves it and refreshes the page, so the screen reloads in the new language
 * at once. Null picks Automatic.
 */
export function useUiLanguage(enabled = true) {
  const router = useRouter();
  const [state, setState] = useState<UiLanguageState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    getUiLanguageState().then(
      (read) => {
        if (current) setState(read);
      },
      // Unread, the list stays empty: the page still works in its language.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [enabled]);

  const pick = useCallback(
    async (locale: AnyUiLocale | null): Promise<boolean> => {
      if (!state) return false;
      const before = state;
      setState({ ...state, selected: locale });
      setSaving(true);
      try {
        await setUiLanguage(locale);
        router.refresh();
        return true;
      } catch {
        setState(before);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [router, state],
  );

  return { state, saving, pick };
}
