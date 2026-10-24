'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingDots } from '@/components/ui/loading-dots';
import { NewContentDialog } from '@/components/content/new-content-dialog';
import { SendDialog } from '@/components/content/send-to-cms-dialog';
import { useUserRole } from '@/hooks/use-user-role';
import { useRouter } from '@/i18n/navigation';
import { getContentAuthors } from '@/lib/actions/content-authors';
import {
  archiveContentDraft,
  deleteContentDraft,
  getContentDraftPages,
  getContentDrafts,
  markContentDraftReady,
  setContentDraftStatus,
} from '@/lib/actions/content-drafts';
import { cmsSource, type CmsSource } from '@/lib/content/cms-send';
import { readCmsStatuses, type CmsStatus } from '@/lib/content/cms-send-client';
import {
  AGENT_POLL_MS,
  CREATED_RANGES,
  LIBRARY_TABS,
  contentEditorPath,
  draftsCreatedIn,
  draftsInTab,
  type ContentDraftListItem,
  type CreatedRange,
  type DraftStatus,
  type LibraryTab,
} from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/page-types';
import { qualityPhase } from '@/lib/content/quality';
import { formatNumber } from '@/lib/format';
import { readUrlChoice, writeUrlParams } from '@/lib/url-state';
import { useBrandStore } from '@/stores/use-brand-store';
import { LibraryExportMenu, useLibraryExport } from './_library-export';
import { LibraryTable, type LibraryRowActions } from './_library-table';
import { HeaderWithAiUsage } from '@/components/ai-usage/ai-usage-meter';

/**
 * A row's page for Send to CMS, made ready as the editor makes its own: its
 * author and the brand's byline line once Quality is live. Null when the
 * page is gone.
 */
async function readSendSource({
  brandId,
  draftId,
  brandName,
  brandLanguage,
  teamByline,
}: {
  brandId: string;
  draftId: string;
  brandName: string;
  brandLanguage: string | null | undefined;
  teamByline: (brand: string) => string;
}): Promise<CmsSource | null> {
  const [{ pages }, authors] = await Promise.all([
    getContentDraftPages(brandId, [draftId]),
    qualityPhase() >= 1 ? getContentAuthors().catch(() => null) : Promise.resolve(null),
  ]);
  const page = pages[0];
  if (!page) return null;
  const name = authors?.brands.find((b) => b.id === brandId)?.name ?? brandName;
  return cmsSource({
    page,
    authors,
    brandId,
    brandName: name,
    brandLanguage,
    teamByline: teamByline(name),
  });
}

/** A read of the brand's drafts: null until it comes back. */
interface LibraryRead {
  brandId: string;
  drafts: ContentDraftListItem[] | null;
  /** Each tab's drafts in all: past the Library's cap, more than it lists. */
  counts: Record<LibraryTab, number> | null;
  failed: boolean;
}

/**
 * The Content Library (Content Editor, CE-002): everything a person or the
 * Content Agent wrote or changed in Ansvisor, by status, and what was
 * archived (00233). A row's menu sets its status; admins and managers also
 * send it to the CMS (#1331), archive, restore and delete. The tab lives in
 * the URL (?tab=in_review), so a link can open "Library › In review".
 */
export default function ContentLibraryPage() {
  const t = useTranslations('contentEditor.library');
  const tEditor = useTranslations('contentEditor.editor');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const [tab, setTab] = useState<LibraryTab>('all');
  // When the drafts listed (and exported) were created: ?created=30d.
  const [created, setCreated] = useState<CreatedRange>('all');
  const [read, setRead] = useState<LibraryRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const { canManage } = useUserRole();
  // The draft whose Delete waits for a confirmation.
  const [deleting, setDeleting] = useState<ContentDraftListItem | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  // Send to CMS: while the row's page is read, then the dialog's page.
  const [preparing, setPreparing] = useState(false);
  const [sending, setSending] = useState<{ brandId: string; source: CmsSource } | null>(null);
  // Each draft's last send, beside its status; read with the list.
  const [cms, setCms] = useState<ReadonlyMap<string, CmsStatus>>(new Map());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTab(readUrlChoice('tab', LIBRARY_TABS, 'all'));
    setCreated(readUrlChoice('created', CREATED_RANGES, 'all'));
  }, []);
  const { exporting, exportList, exportDraft } = useLibraryExport(activeBrandId);

  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    getContentDrafts(activeBrandId)
      .then(({ drafts, counts }) => {
        if (!cancelled) setRead({ brandId: activeBrandId, drafts, counts, failed: false });
      })
      .catch((err) => {
        console.error('Failed to load the content library:', err);
        if (!cancelled) {
          setRead({ brandId: activeBrandId, drafts: null, counts: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, attempt]);

  // While the Content Agent writes a draft (CE-015), the list is read again
  // now and then, so it moves to In review without a reload.
  const agentWriting = !!read?.drafts?.some((draft) => draft.agentState === 'writing');
  useEffect(() => {
    if (!agentWriting) return;
    const timer = setTimeout(() => setAttempt((n) => n + 1), AGENT_POLL_MS);
    return () => clearTimeout(timer);
  }, [agentWriting, read]);

  // The sends of the drafts read, after each read of the list.
  const readIds = read?.drafts?.map((draft) => draft.id).join(',') ?? '';
  const [cmsAttempt, setCmsAttempt] = useState(0);
  useEffect(() => {
    if (!readIds) return;
    let cancelled = false;
    readCmsStatuses(readIds.split(','))
      .then((statuses) => !cancelled && setCms(statuses))
      .catch((err) => console.error('Failed to read the pages’ sends:', err));
    return () => {
      cancelled = true;
    };
  }, [readIds, cmsAttempt]);

  const reload = () => setAttempt((n) => n + 1);
  const titleOf = (draft: ContentDraftListItem) => draft.title.trim() || t('untitled');
  const failed = (err: unknown) => {
    console.error('Failed to change the Library draft:', err);
    toast.error(
      t(
        err instanceof Error && err.message === 'forbidden'
          ? 'rowMenu.forbidden'
          : err instanceof Error && err.message === 'newer_draft'
            ? 'rowMenu.newerDraft'
            : 'rowMenu.failed',
      ),
    );
  };

  const archive = async (draft: ContentDraftListItem, archived: boolean) => {
    try {
      await archiveContentDraft(draft.id, archived);
      reload();
      toast(t(archived ? 'rowMenu.archived' : 'rowMenu.restored', { title: titleOf(draft) }), {
        action: archived
          ? { label: t('rowMenu.undo'), onClick: () => void archive(draft, false) }
          : undefined,
      });
    } catch (err) {
      failed(err);
    }
  };

  const openSend = async (draft: ContentDraftListItem) => {
    if (!activeBrandId || preparing) return;
    // The draft's brand stays the send's, should the brand switch meanwhile.
    const brandId = activeBrandId;
    setPreparing(true);
    const source = await readSendSource({
      brandId,
      draftId: draft.id,
      brandName: activeBrand?.name ?? '',
      brandLanguage: activeBrand?.language,
      teamByline: (brand) => tEditor('author.organization', { brand }),
    }).catch((err) => {
      console.error('Failed to read the page to send:', err);
      return null;
    });
    setPreparing(false);
    if (source) setSending({ brandId, source });
    else toast.error(t('rowMenu.sendFailed'));
  };

  const rowActions: LibraryRowActions = {
    canManage,
    onStatus: (draft: ContentDraftListItem, status: DraftStatus) => {
      // Ready keeps a History version and completes the draft's task, as the editor's Mark ready.
      const change =
        status === 'ready'
          ? markContentDraftReady(draft.id)
          : setContentDraftStatus(draft.id, status);
      change.then(reload, failed);
    },
    onArchive: (draft, archived) => void archive(draft, archived),
    onDelete: setDeleting,
    onExport: (draft, format) => void exportDraft(draft, format),
    onSend: (draft) => void openSend(draft),
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeletePending(true);
    try {
      await deleteContentDraft(deleting.id);
      toast.success(t('rowMenu.deleted', { title: titleOf(deleting) }));
      setDeleting(null);
      reload();
    } catch (err) {
      failed(err);
    }
    setDeletePending(false);
  };

  const changeTab = (next: LibraryTab) => {
    setTab(next);
    writeUrlParams({ tab: next }, { tab: 'all' });
  };
  const changeCreated = (next: CreatedRange) => {
    setCreated(next);
    writeUrlParams({ created: next }, { created: 'all' });
  };

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  // A read for another brand (just switched) counts as still loading.
  const current = read?.brandId === activeBrandId ? read : null;
  const drafts = current?.drafts ?? null;
  const counts = current?.counts ?? null;
  const inTab = drafts ? draftsInTab(drafts, tab) : [];
  const listed = draftsCreatedIn(inTab, created);

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LibraryExportMenu
              disabled={listed.length === 0}
              exporting={exporting}
              onExport={(format) => void exportList(listed, tab, format)}
            />
            <Button className="gap-2" onClick={() => setStarting(true)}>
              <Plus className="h-4 w-4" />
              {t('newContent')}
            </Button>
          </div>
        </div>
      </HeaderWithAiUsage>
      <NewContentDialog
        open={starting}
        onOpenChange={setStarting}
        brandId={activeBrandId}
        siteType={siteTypeOf(activeBrand ?? {})}
        onSent={() => setAttempt((n) => n + 1)}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => changeTab(v as LibraryTab)}>
          <TabsList variant="line" aria-label={t('tabsLabel')}>
            {LIBRARY_TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {t(`tabs.${id}`)}
                {counts && <TabCount count={counts[id]} />}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          value={created}
          onValueChange={(value) => changeCreated(value as CreatedRange)}
          items={CREATED_RANGES.map((range) => ({
            value: range,
            label: `${t('created.label')}: ${t(`created.${range}`)}`,
          }))}
        >
          {/* On the tabs' line when it fits, else on its own, on the right. */}
          <SelectTrigger size="sm" className="ml-auto" aria-label={t('created.label')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {CREATED_RANGES.map((range) => (
              <SelectItem key={range} value={range}>
                {t(`created.${range}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        <CardContent className="px-0">
          {current?.failed ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('loadError')}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRead(null);
                  setAttempt((n) => n + 1);
                }}
              >
                {t('retry')}
              </Button>
            </div>
          ) : drafts === null ? (
            <div className="flex items-center justify-center py-12" aria-busy="true">
              <LoadingDots size="md" className="text-muted-foreground" />
            </div>
          ) : listed.length === 0 && inTab.length > 0 ? (
            <p className="px-6 py-12 text-center text-sm text-muted-foreground">
              {t('created.empty')}
            </p>
          ) : (
            <LibraryTable drafts={listed} tab={tab} actions={rowActions} cms={cms} />
          )}
        </CardContent>
      </Card>
      {sending && (
        <SendDialog
          draftId={sending.source.draftId}
          brandId={sending.brandId}
          title={sending.source.title}
          html={sending.source.html}
          sourceUrl={sending.source.sourceUrl}
          author={sending.source.author}
          teamByline={sending.source.teamByline}
          byline={sending.source.byline}
          // Placeholders are filled in the editor.
          onFillNow={() => router.push(contentEditorPath(sending.source.draftId))}
          // A send that went or failed is the row's last: its sends are read again.
          onClose={() => {
            setSending(null);
            setCmsAttempt((n) => n + 1);
          }}
        />
      )}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="grid-cols-[minmax(0,1fr)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-6 leading-snug [overflow-wrap:anywhere]">
              {t('deleteDialog.title', { title: deleting ? titleOf(deleting) : '' })}
            </DialogTitle>
            <DialogDescription>{t('deleteDialog.description')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletePending}>
              {t('deleteDialog.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deletePending}
            >
              {t('deleteDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {counts && created === 'all' && listed.length < counts[tab] && (
        <p className="text-xs text-muted-foreground">
          {t('latestOnly', {
            shown: formatNumber(listed.length),
            count: formatNumber(counts[tab]),
          })}
        </p>
      )}
    </div>
  );
}

function TabCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
      {formatNumber(count)}
    </span>
  );
}
