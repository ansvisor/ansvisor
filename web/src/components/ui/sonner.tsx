'use client';

import { useEffect, useRef } from 'react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, useSonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';
import { trackErrorShown } from '@/lib/friction-events';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <>
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        icons={{
          success: <CircleCheckIcon className="size-4" />,
          info: <InfoIcon className="size-4" />,
          warning: <TriangleAlertIcon className="size-4" />,
          error: <OctagonXIcon className="size-4" />,
          loading: <Loader2Icon className="size-4 animate-spin" />,
        }}
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--border-radius': 'var(--radius)',
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast: 'cn-toast',
          },
        }}
        {...props}
      />
      <ErrorToastEvents />
    </>
  );
};

/**
 * Counts each error toast as it shows (FRICTION_EVENTS.errorShown), from
 * sonner's own list of the toasts on screen: toast.error, and a
 * toast.promise that failed. A toast updated in place (the same id) counts
 * once; dismissed and shown again, twice. Its text is never read.
 */
function ErrorToastEvents() {
  const { toasts } = useSonner();
  const shown = useRef(new Set<string | number>());
  useEffect(() => {
    const errors = new Set(toasts.filter((t) => t.type === 'error').map((t) => t.id));
    for (const id of errors) if (!shown.current.has(id)) trackErrorShown();
    shown.current = errors;
  }, [toasts]);
  return null;
}

export { Toaster };
