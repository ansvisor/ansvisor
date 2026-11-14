'use client';

import { ChevronDown, Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export type TagMatch = 'all' | 'any';

/**
 * The Tags filter on Tracked Prompts (#2378): pick one or more of the brand's
 * tags; with several picked, Match all keeps the prompts carrying every one
 * and Match any those carrying at least one.
 */
export function TagFilter({
  tagOptions,
  tagFilter,
  tagMatch,
  onFilterChange,
  onMatchChange,
}: {
  tagOptions: string[];
  tagFilter: string[];
  tagMatch: TagMatch;
  onFilterChange: (tags: string[]) => void;
  onMatchChange: (match: TagMatch) => void;
}) {
  const tTags = useTranslations('prompts.tags');
  if (tagOptions.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger
          render={<Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" />}
          aria-label={tTags('label')}
        >
          <Tags className="h-3.5 w-3.5" aria-hidden />
          {tagFilter.length === 0
            ? tTags('allTags')
            : tTags('selected', { count: tagFilter.length })}
          <ChevronDown className="h-3 w-3" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 space-y-2">
          <PopoverTitle className="text-sm font-semibold">{tTags('label')}</PopoverTitle>
          <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label={tTags('label')}>
            {tagOptions.map((tag) => (
              <li key={tag}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={tagFilter.includes(tag)}
                    onCheckedChange={(v) =>
                      onFilterChange(
                        v === true ? [...tagFilter, tag] : tagFilter.filter((x) => x !== tag),
                      )
                    }
                    aria-label={tag}
                  />
                  <span className="flex-1 truncate">{tag}</span>
                </label>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {tagFilter.length > 1 && (
        <Select
          value={tagMatch}
          onValueChange={(v) => onMatchChange((v as TagMatch) ?? 'all')}
          items={[
            { value: 'all', label: tTags('matchAll') },
            { value: 'any', label: tTags('matchAny') },
          ]}
        >
          <SelectTrigger className="h-8 w-28 text-xs" aria-label={tTags('match')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tTags('matchAll')}</SelectItem>
            <SelectItem value="any">{tTags('matchAny')}</SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
