'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUserRole } from '@/hooks/use-user-role';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { getContentRules, updateContentRules } from '@/lib/actions/brand-content-rules';
import { MAX_RULE_ITEMS, type ContentRules } from '@/lib/content/content-rules';

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * A brand's content rules: banned phrases and source allow/deny lists, one
 * item per line. Admins and Managers change them; the rest read them.
 */
export function ContentRulesCard({ brandId }: { brandId: string }) {
  const t = useTranslations('brands.settings.contentRules');
  const tActions = useTranslations('readOnly.actions');
  const { canManage } = useUserRole();
  const { guard } = useUpgradeGate();
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phrases, setPhrases] = useState('');
  const [blocked, setBlocked] = useState('');
  const [allowed, setAllowed] = useState('');
  const [only, setOnly] = useState(false);

  useEffect(() => {
    let live = true;
    void getContentRules(brandId).then((rules) => {
      if (!live) return;
      if (rules) {
        setPhrases(rules.bannedPhrases.join('\n'));
        setBlocked(rules.blockedDomains.join('\n'));
        setAllowed(rules.allowedDomains.join('\n'));
        setOnly(rules.onlyAllowedDomains);
      }
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, [brandId]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateContentRules(brandId, {
        bannedPhrases: lines(phrases),
        blockedDomains: lines(blocked),
        allowedDomains: lines(allowed),
        onlyAllowedDomains: only,
      } satisfies ContentRules);
      if ('error' in res) {
        toast.error(t(`error.${res.error}`, { max: MAX_RULE_ITEMS }));
        return;
      }
      setPhrases(res.rules.bannedPhrases.join('\n'));
      setBlocked(res.rules.blockedDomains.join('\n'));
      setAllowed(res.rules.allowedDomains.join('\n'));
      toast.success(t('saved'));
    } catch (err) {
      console.error('Failed to save the content rules:', err);
      toast.error(t('error.failed'));
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canManage || !loaded || saving;
  const field = (id: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t(`${id}.label`)}</Label>
      <Textarea
        id={id}
        rows={4}
        value={value}
        readOnly={!canManage}
        disabled={!loaded || saving}
        placeholder={t(`${id}.placeholder`)}
        onChange={(e) => set(e.target.value)}
      />
      <p className="text-xs text-muted-foreground">{t(`${id}.hint`, { max: MAX_RULE_ITEMS })}</p>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 space-y-5">
        {field('bannedPhrases', phrases, setPhrases)}
        {field('blockedDomains', blocked, setBlocked)}
        {field('allowedDomains', allowed, setAllowed)}
        <div className="flex items-start gap-3">
          <Checkbox
            id="only-allowed"
            checked={only}
            disabled={readOnly}
            onCheckedChange={(v) => setOnly(v === true)}
          />
          <div className="space-y-1">
            <Label htmlFor="only-allowed">{t('only.label')}</Label>
            <p className="text-xs text-muted-foreground">{t('only.hint')}</p>
          </div>
        </div>
        {canManage ? (
          <Button
            disabled={readOnly}
            onClick={guard(() => void save(), { action: tActions('changeContentRules') })}
          >
            {t('save')}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
        )}
      </CardContent>
    </Card>
  );
}
