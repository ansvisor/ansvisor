'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import { hiddenCount, markHidden } from '@/lib/chat/skills/hidden-marks';
import type { MarketplaceDetail as Detail } from '@/lib/chat/skills/marketplace-store';
import { AddOrState, SkillCounts, addLibrarySkill } from './marketplace-tab';
import { CARD, CARD_HEAD, PILL, ScanList } from './skill-review';

/**
 * A Library skill's detail (CHAT-17 item 9, W4-18; laid out as the
 * review of an import, mockup `#s-skill-review`): its name, line, repo,
 * stars and installs; its SKILL.md read at the commit the catalog pins, as
 * plain text with hidden characters marked; Ansvisor's own safety scan
 * (decision 10); "Edited by Ansvisor" with what the cleanup took out (item
 * 15, in words: the text itself names a competitor); what adding it leaves
 * out; and its source: the file at that commit, the license and its text,
 * and "owner/repo · MIT". Add, or what became of it (W4-19).
 */
export function LibrarySkill({ id }: { id: string }) {
  const t = useTranslations('chatSkills.libraryPage');
  const tCard = useTranslations('chatSkills.library');
  const router = useRouter();
  const { openUpgrade } = useUpgradeGate();
  const [detail, setDetail] = useState<Detail | null | 'failed' | 'missing'>(null);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void fetch(`/api/chat/skills/marketplace/skill?id=${encodeURIComponent(id)}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as {
          ok?: boolean;
          detail?: Detail;
        } | null;
        if (!current) return;
        if (res.ok && body?.ok && body.detail) setDetail(body.detail);
        else setDetail(res.status === 404 ? 'missing' : 'failed');
      })
      .catch(() => {
        if (current) setDetail('failed');
      });
    return () => {
      current = false;
    };
  }, [id, version]);

  const read = detail && typeof detail === 'object' && detail.read.ok ? detail.read : null;
  const pieces = useMemo(() => (read ? markHidden(read.body) : []), [read]);

  async function add() {
    if (!detail || typeof detail !== 'object' || adding) return;
    setAdding(true);
    const added = await addLibrarySkill(detail.skill.id);
    setAdding(false);
    if (!added.ok) {
      if (added.upgrade) openUpgrade();
      else toast.error(added.error ?? tCard('addFailed'));
      return;
    }
    const { skill } = added;
    toast.success(skill.requested ? tCard('requested') : tCard('added'));
    if (detail.can.add === 'add') {
      router.push(`/dashboard/chat/skills/${skill.id}`);
      return;
    }
    setDetail({
      ...detail,
      skill: { ...detail.skill, added: { status: skill.status, skillId: skill.id } },
    });
  }

  const back = (
    <Link
      href="/dashboard/chat/skills?tab=library"
      data-action="librarySkill.back"
      className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="size-3.5" />
      {t('back')}
    </Link>
  );

  if (detail === null) {
    return (
      <div className="max-w-[1100px]" aria-busy>
        {back}
        <Skeleton className="h-8 w-48" />
        <div className="mt-4 grid gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-[420px] rounded-[14px]" />
          <Skeleton className="h-[420px] rounded-[14px]" />
        </div>
      </div>
    );
  }
  if (detail === 'failed' || detail === 'missing') {
    return (
      <div className="max-w-[1100px]">
        {back}
        <p className="rounded-[14px] border bg-card p-6 text-center text-sm text-muted-foreground">
          {t(detail === 'missing' ? 'notFound' : 'loadFailed')}
        </p>
      </div>
    );
  }

  const { skill } = detail;
  const hidden = hiddenCount(pieces);
  const blocked = !!read && read.scan.blocks.length > 0;
  // GitHub couldn't give the file now (busy, failing, gone): worth reading again.
  const github = !detail.read.ok && detail.read.code.startsWith('github_');
  const addable = !!read && !blocked && !skill.added && !!detail.can.add;
  return (
    <div className="max-w-[1100px]" data-slot="library-skill" data-skill={skill.id}>
      {back}
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-2xl font-bold tracking-[-.6px] [overflow-wrap:anywhere]">
          {skill.name}
        </h1>
        <span className="ml-auto">
          {(skill.added || addable) && (
            <AddOrState
              card={skill}
              can={detail.can.add}
              adding={adding}
              onAdd={() => void add()}
              t={tCard}
            />
          )}
        </span>
      </div>
      <p className="mb-2 text-[13px] text-muted-foreground [overflow-wrap:anywhere]">
        {skill.description}
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
        <span data-slot="library-attribution">{t('attribution', { repo: skill.repo })}</span>
        <SkillCounts card={skill} t={tCard} />
      </div>

      <div className="grid items-start gap-3 min-[900px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className={CARD} aria-labelledby="library-file">
          <div className={CARD_HEAD}>
            <span id="library-file">{t('cleaned')}</span>
            <span className={PILL}>{t('plain')}</span>
          </div>
          {!read ? (
            <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
              <p data-slot="library-read-failed">
                {t(github ? 'readFailed' : 'unreadable', {
                  error: detail.read.ok ? '' : detail.read.error,
                })}
              </p>
              {/* GitHub may give it later; a file Ansvisor can't take stays so. */}
              {github && (
                <Button
                  variant="outline"
                  className="mt-3"
                  data-action="librarySkill.retry"
                  onClick={() => {
                    setDetail(null);
                    setVersion((v) => v + 1);
                  }}
                >
                  {t('retry')}
                </Button>
              )}
            </div>
          ) : (
            <>
              {hidden > 0 && (
                <p className="border-b bg-red-50/60 px-4 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-300">
                  {t('hidden', { count: hidden })}
                </p>
              )}
              <pre
                data-slot="library-body"
                className="max-h-[560px] overflow-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
              >
                {pieces.map((piece, i) =>
                  'hidden' in piece ? (
                    <mark
                      key={i}
                      data-slot="hidden-char"
                      title={piece.code}
                      className="mx-px rounded bg-red-100 px-1 text-[11px] text-red-800 dark:bg-red-950/60 dark:text-red-300"
                    >
                      {piece.code}
                    </mark>
                  ) : (
                    <span key={i}>{piece.text}</span>
                  ),
                )}
              </pre>
            </>
          )}
        </section>

        <div className="grid gap-3">
          {read && (
            <section className={CARD} aria-labelledby="library-scan">
              <div className={CARD_HEAD}>
                <span id="library-scan">{t('scan')}</span>
              </div>
              <div className="grid gap-2 px-4 py-3 text-[13px]" data-slot="library-scan">
                {read.scan.blocks.length === 0 && read.scan.warns.length === 0 ? (
                  <p className="text-muted-foreground">{t('clean')}</p>
                ) : (
                  <>
                    <ScanList
                      title={t('blocks')}
                      items={read.scan.blocks}
                      tone="text-red-700 dark:text-red-400"
                      slot="scan-blocks"
                    />
                    <ScanList
                      title={t('warns')}
                      items={read.scan.warns}
                      tone="text-amber-700 dark:text-amber-400"
                      slot="scan-warns"
                    />
                  </>
                )}
              </div>
            </section>
          )}

          {read && read.edits.length > 0 && (
            <section className={CARD} aria-labelledby="library-edited">
              <div className={CARD_HEAD}>
                <span id="library-edited">{t('edited')}</span>
              </div>
              <ul
                className="list-disc space-y-0.5 px-4 py-3 pl-8 text-[13px]"
                data-slot="library-edits"
              >
                {read.edits.map((edit) => (
                  <li key={edit.cleanup}>{t(`edits.${edit.cleanup}`, { lines: edit.lines })}</li>
                ))}
              </ul>
            </section>
          )}

          {read && (
            <section className={CARD} aria-labelledby="library-removed">
              <div className={CARD_HEAD}>
                <span id="library-removed">{t('removed')}</span>
              </div>
              <div className="px-4 py-3 text-[13px]" data-slot="library-removed">
                {read.removed.length === 0 ? (
                  <p className="text-muted-foreground">{t('nothingRemoved')}</p>
                ) : (
                  <ul className="list-disc space-y-0.5 pl-4">
                    {read.removed.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          <section className={CARD} aria-labelledby="library-source">
            <div className={CARD_HEAD}>
              <span id="library-source">{t('source')}</span>
            </div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
              <dt className="text-muted-foreground">{t('file')}</dt>
              <dd className="[overflow-wrap:anywhere]">
                <a
                  href={detail.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  data-slot="library-source-link"
                  className="underline underline-offset-2"
                >
                  {detail.fileUrl.replace(/^https:\/\/github\.com\//, '')}
                </a>
              </dd>
              <dt className="text-muted-foreground">{t('commit')}</dt>
              <dd>
                <code className="text-[12px]">{detail.commit.slice(0, 7)}</code>
              </dd>
              <dt className="text-muted-foreground">{t('license')}</dt>
              <dd>{skill.license}</dd>
            </dl>
            {read?.licenseText && (
              <details className="border-t px-4 py-2.5 text-[12.5px]" data-slot="library-license">
                <summary className="cursor-pointer text-muted-foreground">
                  {t('licenseText')}
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto font-mono text-[11.5px] whitespace-pre-wrap">
                  {read.licenseText}
                </pre>
              </details>
            )}
            {read && detail.can.add && !skill.added && (
              <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-4 py-3">
                <span className="text-xs text-muted-foreground" data-slot="library-note">
                  {blocked
                    ? t('blockedNote')
                    : detail.can.add === 'add'
                      ? t('addNote')
                      : t('requestNote')}
                </span>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
