'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { Textarea } from '@/components/ui/textarea';
import {
  deleteContentAuthor,
  getContentAuthors,
  saveContentAuthor,
  setDefaultAuthor,
} from '@/lib/actions/content-authors';
import {
  MAX_PROFILES,
  type AuthorInput,
  type AuthorsRead,
  type ContentAuthor,
} from '@/lib/content/authors';

/** The organization byline in a brand's default select: no author. */
const ORGANIZATION = '';

/**
 * Settings › Authors (Content Editor Quality spec §9, CE-037): the real
 * people the workspace's pages are by. Anyone adds one; the author themself
 * or an admin edits or deletes it; admins and managers pick each brand's
 * default. "Real people only. Content Agent can't add, edit or invent
 * authors."
 */
export function AuthorsSection() {
  const t = useTranslations('settings.authors');
  const tCommon = useTranslations('common');
  const [read, setRead] = useState<AuthorsRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<ContentAuthor | 'new' | null>(null);
  const [removing, setRemoving] = useState<ContentAuthor | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getContentAuthors();
      setRead(next);
      setFailed(!next);
    } catch {
      setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = (author: ContentAuthor) =>
    !!read && (author.userId === read.me.id || read.me.role === 'admin');
  const canSetDefaults = read?.me.role === 'admin' || read?.me.role === 'manager';
  const defaultOf = (brandId: string) =>
    read?.authors.find((a) => a.defaultFor.includes(brandId))?.id ?? ORGANIZATION;

  const remove = async (author: ContentAuthor) => {
    setBusy(true);
    try {
      await deleteContentAuthor(author.id);
      toast.success(t('deleted', { name: author.name }));
      setRemoving(null);
      await load();
    } catch {
      toast.error(t('deleteFailed'));
    } finally {
      setBusy(false);
    }
  };
  const pickDefault = async (brandId: string, authorId: string) => {
    try {
      await setDefaultAuthor(brandId, authorId || null);
      await load();
    } catch {
      toast.error(t('defaultFailed'));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {t('realPeople')}
        </p>

        {!read && !failed && (
          <p className="text-sm text-muted-foreground" aria-busy="true">
            <LoadingDots className="text-muted-foreground" />
          </p>
        )}
        {failed && (
          <p className="text-sm text-destructive">
            {t('loadFailed')}{' '}
            <button type="button" className="underline" onClick={() => void load()}>
              {tCommon('retry')}
            </button>
          </p>
        )}

        {read && (
          <>
            {read.authors.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('empty')}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {read.authors.map((author) => (
                  <li key={author.id} className="flex items-start gap-3 px-3 py-2.5">
                    <AuthorPhoto author={author} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium [overflow-wrap:anywhere]">
                        {author.name}
                        {author.userId === read.me.id && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {t('you')}
                          </span>
                        )}
                      </p>
                      {author.title && (
                        <p className="text-xs text-muted-foreground">{author.title}</p>
                      )}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t('profiles', { count: author.sameAs.length })}
                        {author.defaultFor.length > 0 && (
                          <>
                            {' · '}
                            {t('defaultFor', {
                              brands: read.brands
                                .filter((b) => author.defaultFor.includes(b.id))
                                .map((b) => b.name)
                                .join(', '),
                            })}
                          </>
                        )}
                      </p>
                    </div>
                    {canEdit(author) && (
                      <span className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(author)}>
                          {t('edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setRemoving(author)}
                        >
                          {t('delete')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" onClick={() => setEditing('new')}>
              {t('add')}
            </Button>

            {read.brands.length > 0 && (
              <section className="space-y-2" aria-label={t('defaultsTitle')}>
                <h3 className="text-sm font-medium">{t('defaultsTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('defaultsHint')}</p>
                <ul className="space-y-2">
                  {read.brands.map((brand) => (
                    <li key={brand.id} className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={`default-${brand.id}`} className="min-w-32 text-sm">
                        {brand.name}
                      </Label>
                      <select
                        id={`default-${brand.id}`}
                        className="h-8 rounded-md border bg-background px-2 text-sm disabled:opacity-60"
                        value={defaultOf(brand.id)}
                        disabled={!canSetDefaults}
                        onChange={(e) => void pickDefault(brand.id, e.target.value)}
                      >
                        <option value={ORGANIZATION}>
                          {t('organizationByline', { brand: brand.name })}
                        </option>
                        {read.authors.map((author) => (
                          <option key={author.id} value={author.id}>
                            {author.name}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
                {!canSetDefaults && (
                  <p className="text-xs text-muted-foreground">{t('defaultsManagers')}</p>
                )}
              </section>
            )}
          </>
        )}
      </CardContent>

      <Dialog open={removing !== null} onOpenChange={(next) => !next && !busy && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deleteTitle', { name: removing?.name ?? '' })}</DialogTitle>
            <DialogDescription>{t('deleteDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={busy} />}>
              {tCommon('cancel')}
            </DialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => removing && void remove(removing)}
            >
              {busy && <LoadingDots className="mr-1.5" />}
              {t('delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthorDialog
        author={editing === 'new' ? null : editing}
        open={editing !== null}
        isMine={editing !== null && editing !== 'new' && editing.userId === read?.me.id}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    </Card>
  );
}

/** The author's photo, or their initials. */
function AuthorPhoto({ author }: { author: ContentAuthor }) {
  const initials = author.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return author.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- any https host the person names
    <img
      src={author.photoUrl}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
    >
      {initials}
    </span>
  );
}

/** Add or edit an author: name, title, a short bio, profile links, a photo. */
function AuthorDialog({
  author,
  open,
  isMine,
  onClose,
  onSaved,
}: {
  author: ContentAuthor | null;
  open: boolean;
  isMine: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useTranslations('settings.authors');
  const tCommon = useTranslations('common');
  const [form, setForm] = useState<{
    name: string;
    title: string;
    bio: string;
    photoUrl: string;
    links: string;
    isMe: boolean;
  }>({ name: '', title: '', bio: '', photoUrl: '', links: '', isMe: false });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      name: author?.name ?? '',
      title: author?.title ?? '',
      bio: author?.bio ?? '',
      photoUrl: author?.photoUrl ?? '',
      links: author?.sameAs.join('\n') ?? '',
      isMe: isMine,
    });
  }, [open, author, isMine]);

  const links = form.links
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const badLink = links.find((l) => !/^https:\/\/\S+$/.test(l));
  const badPhoto = form.photoUrl.trim() !== '' && !/^https:\/\/\S+$/.test(form.photoUrl.trim());
  const invalid =
    !form.name.trim() || links.length > MAX_PROFILES || !!badLink || badPhoto || saving;

  const save = async () => {
    setSaving(true);
    try {
      const input: AuthorInput = {
        ...(author ? { id: author.id } : {}),
        name: form.name,
        title: form.title,
        bio: form.bio,
        photoUrl: form.photoUrl,
        sameAs: links,
        isMe: form.isMe,
      };
      await saveContentAuthor(input);
      toast.success(t('saved', { name: form.name.trim() }));
      await onSaved();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{author ? t('editTitle') : t('addTitle')}</DialogTitle>
          <DialogDescription>{t('realPeople')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="author-name">{t('fields.name')}</Label>
            <Input
              id="author-name"
              value={form.name}
              maxLength={120}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-title">{t('fields.title')}</Label>
            <Input
              id="author-title"
              value={form.title}
              maxLength={120}
              placeholder={t('fields.titleHint')}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-bio">{t('fields.bio')}</Label>
            <Textarea
              id="author-bio"
              value={form.bio}
              maxLength={400}
              rows={3}
              placeholder={t('fields.bioHint')}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-links">{t('fields.links')}</Label>
            <Textarea
              id="author-links"
              value={form.links}
              rows={3}
              placeholder="https://www.linkedin.com/in/…"
              aria-describedby="author-links-hint"
              onChange={(e) => setForm({ ...form, links: e.target.value })}
            />
            <p id="author-links-hint" className="text-xs text-muted-foreground">
              {badLink
                ? t('fields.linkInvalid', { link: badLink })
                : t('fields.linksHint', { max: MAX_PROFILES })}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="author-photo">{t('fields.photo')}</Label>
            <Input
              id="author-photo"
              value={form.photoUrl}
              placeholder="https://"
              aria-invalid={badPhoto}
              onChange={(e) => setForm({ ...form, photoUrl: e.target.value })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={form.isMe}
              onCheckedChange={(checked) => setForm({ ...form, isMe: checked === true })}
            />
            {t('fields.isMe')}
          </label>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={saving} />}>
            {tCommon('cancel')}
          </DialogClose>
          <Button onClick={() => void save()} disabled={invalid}>
            {saving && <LoadingDots className="mr-1.5" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
