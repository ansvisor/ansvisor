'use client';

/**
 * Competitor types (00542) in the app: the type picker an add or edit form
 * holds, the small label a competitor's row shows, and the Set type dialog
 * the Competitors page and brand settings open. The types offered are the
 * generic ones and the brand's own labels (competitorTypeOptions over the
 * brand's competitors).
 */

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { setCompetitorTypes } from '@/lib/actions/competitor';
import {
  COMPETITOR_TYPE_MAX_LENGTH,
  competitorTypeLabel,
  normalizeCompetitorType,
} from '@/lib/competitor-types';
import { cn } from '@/lib/utils';
import type { Competitor } from '@/types';

// The picker's two choices that aren't a type. A stored type has no leading
// space (competitors_type_check), so neither can be one.
const NO_TYPE = ' none';
const NEW_TYPE = ' new';

/**
 * A competitor's type as a form field: No type, the types offered, or a new
 * one typed in. `value` is the stored type (or what is being typed for a new
 * one); `onChange` gets the same.
 */
export function CompetitorTypePicker({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  id?: string;
  value: string | null;
  options: readonly string[];
  onChange: (type: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('competitors.type');
  const newId = useId();
  // A value the options don't list is a new type being typed in.
  const [creating, setCreating] = useState(() => value !== null && !options.includes(value));
  const selected = creating ? NEW_TYPE : (value ?? NO_TYPE);
  const items = [
    { value: NO_TYPE, label: t('none') },
    ...options.map((type) => ({ value: type, label: competitorTypeLabel(type) ?? type })),
    { value: NEW_TYPE, label: t('newType') },
  ];
  const tooLong = creating && (value ?? '').trim().length > COMPETITOR_TYPE_MAX_LENGTH;

  return (
    <div className={cn('grid gap-2', className)}>
      <Select
        items={items}
        value={selected}
        disabled={disabled}
        onValueChange={(next: string | null) => {
          if (next === NEW_TYPE) {
            setCreating(true);
            onChange('');
          } else {
            setCreating(false);
            onChange(!next || next === NO_TYPE ? null : next);
          }
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {creating && (
        <div className="grid gap-1.5">
          <Label htmlFor={newId} className="text-xs">
            {t('newTypeLabel')}
          </Label>
          <Input
            id={newId}
            value={value ?? ''}
            placeholder={t('newTypePlaceholder')}
            maxLength={COMPETITOR_TYPE_MAX_LENGTH + 10}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${newId}-hint`}
            disabled={disabled}
            autoFocus
            onChange={(e) => onChange(e.target.value)}
          />
          <p
            id={`${newId}-hint`}
            className={cn('text-xs', tooLong ? 'text-destructive' : 'text-muted-foreground')}
          >
            {tooLong ? t('tooLong') : t('newTypeHint')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Whether a picked or typed type can be saved: No type, a type offered, or
 * a new one with a name no longer than the database keeps. A new type with
 * nothing typed yet ('') can't.
 */
export function competitorTypeIsValid(value: string | null): boolean {
  if (value === null) return true;
  return value.trim() !== '' && normalizeCompetitorType(value).ok;
}

/** A competitor's type as a small label; nothing for one without a type. */
export function CompetitorTypeBadge({
  type,
  className,
}: {
  type: string | null | undefined;
  className?: string;
}) {
  const label = competitorTypeLabel(type);
  if (!label) return null;
  return (
    <Badge
      variant="outline"
      className={cn('max-w-[12rem] truncate px-1.5 py-0 text-[10px] font-normal', className)}
      title={label}
    >
      {label}
    </Badge>
  );
}

/**
 * Set type for one competitor: its type picker and Save. Saves through
 * setCompetitorTypes and hands the changed rows back.
 */
export function SetCompetitorTypeDialog({
  brandId,
  competitor,
  options,
  onOpenChange,
  onSaved,
}: {
  brandId: string;
  /** The competitor whose type is set; null keeps the dialog closed. */
  competitor: Competitor | null;
  options: readonly string[];
  onOpenChange: (open: boolean) => void;
  onSaved: (changed: Competitor[]) => void;
}) {
  const [saving, setSaving] = useState(false);

  return (
    <Dialog
      open={competitor !== null}
      onOpenChange={(open) => {
        if (!saving) onOpenChange(open);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {competitor && (
          // Keyed: each competitor opens with its own type.
          <SetTypeForm
            key={competitor.id}
            brandId={brandId}
            competitor={competitor}
            options={options}
            saving={saving}
            onSaving={setSaving}
            onCancel={() => onOpenChange(false)}
            onSaved={(changed) => {
              onSaved(changed);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SetTypeForm({
  brandId,
  competitor,
  options,
  saving,
  onSaving,
  onCancel,
  onSaved,
}: {
  brandId: string;
  competitor: Competitor;
  options: readonly string[];
  saving: boolean;
  onSaving: (saving: boolean) => void;
  onCancel: () => void;
  onSaved: (changed: Competitor[]) => void;
}) {
  const t = useTranslations('competitors.type');
  const common = useTranslations('competitors');
  const pickerId = useId();
  const [value, setValue] = useState<string | null>(competitor.type ?? null);
  const name = competitor.name;
  const valid = competitorTypeIsValid(value);

  async function save() {
    if (!valid || saving) return;
    onSaving(true);
    try {
      const changed = await setCompetitorTypes(brandId, [competitor.id], value);
      const type = competitorTypeLabel(changed[0]?.type ?? null);
      toast.success(type ? t('saved', { name, type }) : t('cleared', { name }));
      onSaved(changed);
    } catch {
      toast.error(t('saveError'));
    } finally {
      onSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('setTitle', { name })}</DialogTitle>
        <DialogDescription>{t('setDescription', { name })}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 py-4">
        <Label htmlFor={pickerId}>{t('label')}</Label>
        <CompetitorTypePicker
          id={pickerId}
          value={value}
          options={options}
          onChange={setValue}
          disabled={saving}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {common('cancel')}
        </Button>
        <Button type="submit" disabled={saving || !valid}>
          {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
