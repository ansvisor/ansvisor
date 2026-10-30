'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ChatComposer } from '@/components/chat/composer/chat-composer';
import { RoleProvider } from '@/components/providers/role-provider';
import type { ChatMode } from '@/lib/chat/precedence';

/** How long the preview's pretend run answers. */
const RUN_MS = 6000;

/**
 * The composer (W1-10) for design sign-off: Chat home's, an open chat's dock
 * with a pretend run (Stop and steering), and an Analyst's read-only one.
 * Nothing is sent: a send starts a run of a few seconds here.
 */
export function ComposerPreview() {
  const t = useTranslations('chatComposer.preview');
  const [mode, setMode] = useState<ChatMode>('auto');
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const run = () => {
    if (timer.current) clearTimeout(timer.current);
    setRunning(true);
    timer.current = setTimeout(() => setRunning(false), RUN_MS);
  };
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    setRunning(false);
    toast(t('stopped'));
  };

  return (
    <section className="rounded-[14px] border bg-card p-4 shadow-[0_1px_2px_rgba(10,10,10,.04)]">
      <h2 className="mb-4 text-sm font-semibold">
        {t('title')}
        <span className="ml-2 font-normal text-muted-foreground">{t('note')}</span>
      </h2>
      <div className="grid gap-8">
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">{t('home')}</figcaption>
          <div className="mx-auto w-full max-w-[720px]">
            <ChatComposer
              variant="home"
              mode={mode}
              onModeChange={setMode}
              fullAutoOpen
              onSend={(text) => {
                toast(t('sent', { text }));
                run();
              }}
            />
          </div>
        </figure>
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">
            {running ? t('dockRunning') : t('dock')}
          </figcaption>
          <div className="mx-auto w-full max-w-[720px]">
            <ChatComposer
              mode={mode}
              onModeChange={setMode}
              fullAutoOpen={false}
              running={running}
              onSend={() => run()}
              onStop={stop}
              onSteer={(text) => {
                toast(t('steered', { text }));
                run();
              }}
            />
          </div>
        </figure>
        <figure className="m-0 grid gap-2">
          <figcaption className="text-xs text-muted-foreground">{t('readOnly')}</figcaption>
          <div className="mx-auto w-full max-w-[400px]">
            <RoleProvider role="analyst">
              <ChatComposer
                variant="panel"
                mode="auto"
                onModeChange={() => {}}
                fullAutoOpen
                onSend={() => run()}
              />
            </RoleProvider>
          </div>
        </figure>
      </div>
    </section>
  );
}
