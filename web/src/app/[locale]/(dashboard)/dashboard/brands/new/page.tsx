'use client';

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { createBrand, markBrandAsEcommerce, updateBrand } from '@/lib/actions/brand';
import { TopicAccordion } from '@/components/onboarding/topic-accordion';
import { EcommerceNote } from '@/components/onboarding/ecommerce-note';
import { syncDomains } from '@/lib/actions/brand-domain';
import { createTopics } from '@/lib/actions/topic';
import { getPromptCapacity, savePromptSet } from '@/lib/actions/prompt';
import { addCompetitor } from '@/lib/actions/competitor';
import { addCompetitorChoice, mergeCompetitorSuggestions } from '@/lib/competitor-list';
import { triggerTrackingCheck } from '@/lib/actions/tracking';
import { bootstrapBrandVolumes } from '@/lib/actions/volumes';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { trackSavedWaiting } from '@/components/prompts/waiting-for-spot';
import {
  defaultPickCount,
  pickedCount,
  promptRoom,
  withDefaultPicks,
  type TopicPromptPicks,
} from '@/lib/onboarding-prompt-picks';
import { getFaviconUrl } from '@/lib/favicon';
import { frictionFlow } from '@/lib/friction-events';
import { useBrandStore } from '@/stores/use-brand-store';
import {
  REGIONS,
  US_STATES,
  LANGUAGES,
  REGION_ITEMS,
  US_STATE_ITEMS,
  LANGUAGE_ITEMS,
} from '@/config/prompt-options';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import { getPlan, toPlanId, type PlanId } from '@/config/plans';
import type { Brand } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, Check, Globe, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BRAND_SETUP_LIMITS,
  detectSiteType,
  suggestTopics,
  generatePromptsFromTopics,
  suggestCompetitors,
} from '@/lib/ai-brand-setup';

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            'h-1.5 rounded-full transition-all',
            i + 1 === current
              ? 'w-6 bg-foreground'
              : i + 1 < current
                ? 'w-1.5 bg-foreground'
                : 'w-1.5 bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}

// ── Brand header (Steps 2-5) ───────────────────────────────────────────────────

function BrandHeader({ name, domain }: { name: string; domain: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-8">
      {domain && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={getFaviconUrl(domain, 32)} alt="" className="h-6 w-6 rounded" />
      )}
      <span className="text-sm font-medium">{name}</span>
      {domain && <span className="text-sm text-muted-foreground">{domain}</span>}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Keys under brands.new, resolved when the loading effect runs.
const TOPIC_LOADING_MESSAGES = [
  'loading.topics.researching',
  'loading.topics.industry',
  'loading.topics.themes',
  'loading.topics.audience',
  'loading.topics.competitive',
  'loading.topics.almost',
] as const;

const COMPETITOR_LOADING_MESSAGES = [
  'loading.competitors.searching',
  'loading.competitors.market',
  'loading.competitors.players',
  'loading.competitors.verifying',
  'loading.competitors.finalizing',
] as const;

const TOTAL_STEPS = 5;

/** brand_add: from this page's first step to Finish. */
const BRAND_ADD = frictionFlow('brand_add');

// ── Main page ──────────────────────────────────────────────────────────────────

export default function NewBrandPage() {
  const router = useRouter();
  const { addBrand, setActiveBrand, updateBrand: updateBrandInStore } = useBrandStore();
  // A read-only workspace (plan not active), also when this page is opened
  // directly: the brand isn't created, the upgrade dialog opens instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  // Prompts past the plan's limit are saved waiting for a spot, not held back.
  const tWaiting = useTranslations('prompts.waiting');
  const t = useTranslations('brands.new');
  const tPrompts = useTranslations('onboarding.prompts');
  // The state picker's own "no state" choice, ahead of the states themselves.
  const stateItems = [{ value: 'nationwide', label: t('step2.nationwide') }, ...US_STATE_ITEMS];

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => BRAND_ADD.started(), []);

  // Step 1
  const [brandName, setBrandName] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');

  // Step 2
  const [region, setRegion] = useState('US');
  const [usState, setUsState] = useState('');
  const [language, setLanguage] = useState('en');

  // Intermediate state
  const [createdBrand, setCreatedBrand] = useState<Brand | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>('starter');

  // Step 3
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [customTopic, setCustomTopic] = useState('');
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicSuggestError, setTopicSuggestError] = useState(false);
  const [topicLoadingMsg, setTopicLoadingMsg] = useState('');
  const topicMsgIdx = useRef(0);

  useEffect(() => {
    if (!loadingTopics) {
      topicMsgIdx.current = 0;
      return;
    }
    setTopicLoadingMsg(t(TOPIC_LOADING_MESSAGES[0]));
    topicMsgIdx.current = 0;

    const interval = setInterval(() => {
      topicMsgIdx.current = (topicMsgIdx.current + 1) % TOPIC_LOADING_MESSAGES.length;
      setTopicLoadingMsg(t(TOPIC_LOADING_MESSAGES[topicMsgIdx.current]));
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingTopics, t]);

  // Step 4
  const [topicPrompts, setTopicPrompts] = useState<TopicPromptPicks[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [promptCapacity, setPromptCapacity] = useState<{
    maxPrompts: number;
    used: number;
  } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Step 5
  interface CompetitorItem {
    name: string;
    domain: string;
    selected: boolean;
  }
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<CompetitorItem[]>([]);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);
  const [competitorSuggestError, setCompetitorSuggestError] = useState(false);
  const [ecommerceDetected, setEcommerceDetected] = useState(false);
  const ecommerceSetup = useRef<Promise<void> | null>(null);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorDomain, setCompetitorDomain] = useState('');
  const [savingCompetitors, setSavingCompetitors] = useState(false);
  const [competitorLoadingMsg, setCompetitorLoadingMsg] = useState('');
  const competitorMsgIdx = useRef(0);

  const currentPlan = getPlan(currentPlanId);
  const allowedScraperIds = currentPlan.limits.allowedScrapers;
  const activeScrapers = allowedScraperIds
    ? ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id))
    : ALL_SCRAPERS;
  // From context, not the static plan config: Enterprise orgs can have Claude
  // switched on per customer via plan_overrides, which the layout merges in.
  const { allowedModelIds } = usePlanContext();
  const activeModels = allowedModelIds
    ? ALL_MODELS.filter((m) => allowedModelIds.includes(m.id))
    : ALL_MODELS;

  useEffect(() => {
    if (!loadingCompetitors) {
      competitorMsgIdx.current = 0;
      return;
    }
    setCompetitorLoadingMsg(t(COMPETITOR_LOADING_MESSAGES[0]));
    competitorMsgIdx.current = 0;

    const interval = setInterval(() => {
      competitorMsgIdx.current =
        (competitorMsgIdx.current + 1) % COMPETITOR_LOADING_MESSAGES.length;
      setCompetitorLoadingMsg(t(COMPETITOR_LOADING_MESSAGES[competitorMsgIdx.current]));
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingCompetitors, t]);

  // Auto-fetch competitor suggestions when arriving at step 5 with none loaded
  useEffect(() => {
    if (step === 5 && !loadingCompetitors && suggestedCompetitors.length === 0 && createdBrand) {
      fetchCompetitorSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Know the plan's prompt cap while reviewing, so the step can warn and
  // disable Continue instead of failing the save afterwards.
  useEffect(() => {
    if (step === 4 && createdBrand && !promptCapacity) {
      getPromptCapacity(createdBrand.id)
        .then(setPromptCapacity)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, createdBrand]);

  // Load current plan from org on mount
  useEffect(() => {
    async function loadPlan() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();

        if (profile?.organization_id) {
          const { data: org } = await supabase
            .from('organizations')
            .select('plan')
            .eq('id', profile.organization_id)
            .single();
          if (org?.plan) setCurrentPlanId(toPlanId(org.plan));
        }
      } catch {
        // Non-critical
      }
    }
    loadPlan();
  }, []);

  const domain = website
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();

  // ── Step 2 → Step 3 transition: create brand ──

  const handleCreateBrand = async () => {
    setIsLoading(true);
    try {
      // logo_url starts null — BrandAvatar derives the favicon at render time.

      // Back → Continue must not create a second brand (#447): once the brand
      // exists, re-submitting this step updates it in place instead.
      if (createdBrand) {
        let brand = await updateBrand(createdBrand.id, {
          name: brandName.trim(),
          description: description.trim() || null,
          region,
          state: region === 'US' ? usState || null : null,
          language,
        });

        const previousDomain =
          createdBrand.domains.find((d) => d.isPrimary)?.domain ?? createdBrand.domains[0]?.domain;
        if (domain !== (previousDomain ?? '')) {
          const domains = await syncDomains(
            createdBrand.id,
            domain ? [{ domain, isPrimary: true }] : [],
          );
          brand = { ...brand, domains };
        }

        setCreatedBrand(brand);
        updateBrandInStore(brand.id, brand);
      } else {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error(t('errors.notAuthenticated'));

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id')
          .eq('id', user.id)
          .single();

        if (!profile?.organization_id) throw new Error(t('errors.noOrganization'));

        const result = await createBrand({
          organizationId: profile.organization_id,
          name: brandName.trim(),
          description: description.trim() || undefined,
          region,
          state: region === 'US' ? usState || undefined : undefined,
          language,
          domains: domain ? [{ domain, isPrimary: true }] : [],
        });
        if ('error' in result) {
          BRAND_ADD.failed(result.code);
          toast.error(result.error);
          return;
        }
        const { brand } = result;

        setCreatedBrand(brand);
        addBrand(brand);
        setActiveBrand(brand.id);
        void detectBrandType(brand.id);
      }

      setStep(3);

      if (suggestedTopics.length === 0) {
        fetchTopicSuggestions();
      }
    } catch (err) {
      BRAND_ADD.failed();
      toast.error(err instanceof Error ? err.message : t('errors.saveBrand'));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Topic suggestion ──

  const fetchTopicSuggestions = async () => {
    setLoadingTopics(true);
    setTopicSuggestError(false);
    try {
      const { topics } = await suggestTopics({
        brandName: brandName.trim(),
        description: description.trim(),
        website: domain,
        language,
      });
      setSuggestedTopics(topics);
      setSelectedTopics(new Set(topics.slice(0, 7)));
    } catch (err) {
      // Inline banner + Try again instead of a transient toast (#447) — a
      // toast leaves the user stranded on an empty step with no way forward.
      console.error('Topic suggestion error:', err);
      setTopicSuggestError(true);
    } finally {
      setLoadingTopics(false);
    }
  };

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        next.delete(topic);
      } else if (next.size < 10) {
        next.add(topic);
      }
      return next;
    });
  };

  const addCustomTopic = () => {
    const trimmed = customTopic.trim();
    if (trimmed && !suggestedTopics.includes(trimmed)) {
      setSuggestedTopics((prev) => [...prev, trimmed]);
      setSelectedTopics((prev) => {
        if (prev.size < 10) {
          const next = new Set(prev);
          next.add(trimmed);
          return next;
        }
        return prev;
      });
      setCustomTopic('');
    }
  };

  // ── Step 3 → Step 4: generate prompts from topics ──

  const handleGeneratePrompts = async () => {
    if (!createdBrand) return;
    setLoadingPrompts(true);
    try {
      const topicNames = Array.from(selectedTopics);
      await createTopics(createdBrand.id, topicNames);

      const [{ topicPrompts: generated }, capacity] = await Promise.all([
        generatePromptsFromTopics(
          {
            brandName: brandName.trim(),
            description: description.trim(),
            website: domain,
            language,
          },
          topicNames,
        ),
        getPromptCapacity(createdBrand.id).catch(() => null),
      ]);
      if (capacity) setPromptCapacity(capacity);
      setTopicPrompts(withDefaultPicks(generated, defaultPickCount(promptRoom(capacity))));
      setStep(4);
    } catch (err) {
      console.error('Prompt generation error:', err);
      BRAND_ADD.failed();
      toast.error(t('errors.generatePrompts'));
    } finally {
      setLoadingPrompts(false);
    }
  };

  // ── Step 4 → Step 5: save prompts + fetch competitors ──

  const handleSavePromptsAndContinue = async () => {
    if (!createdBrand) return;
    setIsLoading(true);
    setSaveError(null);
    try {
      const allPrompts = topicPrompts.flatMap((tp) =>
        tp.prompts
          .filter((p) => p.picked)
          .map(({ text }) => ({
            text,
            category: tp.topic,
            platforms: activeScrapers.map((s) => s.id),
            models: activeModels.map((m) => m.id),
            isActive: true,
          })),
      );

      if (allPrompts.length === 0) {
        setSaveError(t('errors.noPrompts'));
        setIsLoading(false);
        return;
      }

      const result = await savePromptSet({
        brandId: createdBrand.id,
        name: 'Brand Setup Prompts',
        prompts: allPrompts,
      });
      if ('error' in result) {
        BRAND_ADD.failed(result.code);
        // No technical toasts on this step: actionable failures (plan limit)
        // show verbatim inline, anything else gets a friendly retry message.
        setSaveError(result.code === 'plan_limit' ? result.error : t('errors.savePrompts'));
        return;
      }
      trackSavedWaiting('new_brand', result.waiting ?? 0);

      setStep(5);
      fetchCompetitorSuggestions();
    } catch {
      BRAND_ADD.failed();
      setSaveError(t('errors.savePrompts'));
    } finally {
      setIsLoading(false);
    }
  };

  // ── Competitor suggestion ──

  const fetchCompetitorSuggestions = async () => {
    setLoadingCompetitors(true);
    setCompetitorSuggestError(false);
    try {
      const { competitors, isEcommerce } = await suggestCompetitors({
        brandName: brandName.trim(),
        description: description.trim(),
        website: domain,
        language,
        region,
      });
      setSuggestedCompetitors((prev) => mergeCompetitorSuggestions(prev, competitors));
      // Kept, so Finish waits for it: it updates the prompts one by one.
      if (isEcommerce) ecommerceSetup.current = turnOnProductVisibility();
    } catch (err) {
      console.error('Competitor suggestion error:', err);
      setCompetitorSuggestError(true);
    } finally {
      setLoadingCompetitors(false);
    }
  };

  // The brand's kind of site, from its home page (Step 0): in the
  // background, best effort; the app goes on guessing when it can't tell.
  const detectBrandType = async (brandId: string) => {
    try {
      const { siteType, industry } = await detectSiteType(brandId);
      if (!siteType) return;
      const updates = {
        siteType,
        siteTypeSource: 'auto' as const,
        ...(industry ? { industry } : {}),
      };
      setCreatedBrand((b) => (b?.id === brandId ? { ...b, ...updates } : b));
      updateBrandInStore(brandId, updates);
    } catch (err) {
      console.error('Site type detection error:', err);
    }
  };

  // The research found an online store: Shopping mode goes on, so Product
  // Visibility shows in the menu. Best effort: it can be turned on in the
  // brand's settings too.
  const turnOnProductVisibility = async () => {
    if (!createdBrand || createdBrand.shoppingModeEnabled) return;
    try {
      const { industry, siteType } = await markBrandAsEcommerce(createdBrand.id);
      const updates = {
        industry: industry ?? undefined,
        shoppingModeEnabled: true,
        ...(siteType ? { siteType, siteTypeSource: 'auto' as const } : {}),
      };
      setCreatedBrand({ ...createdBrand, ...updates });
      updateBrandInStore(createdBrand.id, updates);
      setEcommerceDetected(true);
    } catch (err) {
      console.error('E-commerce setup error:', err);
    }
  };

  const toggleCompetitor = (index: number) => {
    setSuggestedCompetitors((prev) =>
      prev.map((c, i) => (i === index ? { ...c, selected: !c.selected } : c)),
    );
  };

  const removeCompetitor = (index: number) => {
    setSuggestedCompetitors((prev) => prev.filter((_, i) => i !== index));
  };

  const addManualCompetitor = () => {
    const { list, duplicate } = addCompetitorChoice(
      suggestedCompetitors,
      competitorName,
      competitorDomain,
    );
    if (list === suggestedCompetitors) return;
    if (duplicate) toast.info(t('toasts.duplicateCompetitor', { name: duplicate.name }));
    setSuggestedCompetitors(list);
    setCompetitorName('');
    setCompetitorDomain('');
  };

  /**
   * The list to save: a competitor still sitting in the manual fields — typed
   * but never added with "+" — is one the user meant to track, so Finish
   * takes it along instead of dropping it.
   */
  const takePendingCompetitor = () => {
    const { list } = addCompetitorChoice(suggestedCompetitors, competitorName, competitorDomain);
    if (list !== suggestedCompetitors) {
      setSuggestedCompetitors(list);
      setCompetitorName('');
      setCompetitorDomain('');
    }
    return list;
  };

  // ── Step 5: final save ──

  const handleFinish = async () => {
    if (!createdBrand) return;
    setSavingCompetitors(true);
    try {
      // Shopping mode first, if it is still going on: the first run should
      // track ChatGPT Shopping on every prompt, not some of them.
      await ecommerceSetup.current;
      const selected = takePendingCompetitor().filter((c) => c.selected);
      if (selected.length > 0) {
        await Promise.all(
          selected.map((c) => addCompetitor(createdBrand.id, { name: c.name, domain: c.domain })),
        );
      }

      try {
        const { jobId } = await triggerTrackingCheck(createdBrand.id);
        localStorage.setItem(
          'aeo:tracking-job',
          JSON.stringify({
            jobId,
            brandId: createdBrand.id,
            startedAt: Date.now(),
          }),
        );
      } catch {
        // Non-critical — scheduled tracking will still run
      }

      // Volumes run alongside the scrape rather than waiting for someone to
      // find the Analyze button. Awaited only until the server has taken the
      // work: the run itself outlives this page, but a server action left
      // in flight would be cancelled by the navigation below.
      await bootstrapBrandVolumes(createdBrand.id);

      BRAND_ADD.completed();
      toast.success(t('toasts.setupComplete'));
      // The person's start page: Insights on a paid plan, Chat Home in the free trial.
      router.push('/dashboard');
    } catch (err) {
      BRAND_ADD.failed();
      toast.error(err instanceof Error ? err.message : t('errors.saveCompetitors'));
      setSavingCompetitors(false);
    }
  };

  // ── Topic prompt editing helpers ──

  const removeTopic = (index: number) => {
    setTopicPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const addPromptToTopic = (topicIndex: number, prompt: string) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) =>
        i === topicIndex ? { ...tp, prompts: [...tp.prompts, { text: prompt, picked: true }] } : tp,
      ),
    );
  };

  const togglePrompt = (topicIndex: number, promptIndex: number) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) =>
        i === topicIndex
          ? {
              ...tp,
              prompts: tp.prompts.map((p, pi) =>
                pi === promptIndex ? { ...p, picked: !p.picked } : p,
              ),
            }
          : tp,
      ),
    );
  };

  // The prompts offered, and the ticked ones: only those are saved and count
  // toward the plan.
  const offeredPrompts = topicPrompts.reduce((sum, tp) => sum + tp.prompts.length, 0);
  const totalPrompts = pickedCount(topicPrompts);
  // Prompts this brand may save before hitting the org's plan cap (null =
  // unknown or unlimited); over that, Continue is disabled with an inline hint.
  const promptLimit = promptRoom(promptCapacity);
  const overPrompts = promptLimit !== null ? Math.max(0, totalPrompts - promptLimit) : 0;

  // ── Step 1: Brand Info ──

  if (step === 1) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{t('step1.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('step1.subtitle')}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="brandName">{t('step1.brandName')}</Label>
              <Input
                id="brandName"
                placeholder={t('step1.brandNamePlaceholder')}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">{t('step1.website')}</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                  {t('step1.protocol')}
                </span>
                <Input
                  id="website"
                  placeholder={t('step1.websitePlaceholder')}
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="rounded-l-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                {t.rich('step1.describe', {
                  optional: (chunks) => <span className="text-muted-foreground">{chunks}</span>,
                })}
              </Label>
              <Textarea
                id="description"
                placeholder={t('step1.descriptionPlaceholder')}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
              <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
                <li>{t('step1.hintIndustry')}</li>
                <li>{t('step1.hintAudience')}</li>
              </ul>
            </div>

            <Button
              className="w-full"
              disabled={!brandName.trim() || !website.trim()}
              onClick={() => setStep(2)}
            >
              {t('continue')}
            </Button>
          </div>
        </div>

        <StepDots current={1} total={TOTAL_STEPS} />
      </div>
    );
  }

  // ── Step 2: Region & Language ──

  if (step === 2) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <BrandHeader name={brandName} domain={domain} />

          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('step2.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('step2.subtitle')}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t('step2.region')}</Label>
              <Select
                items={REGION_ITEMS}
                value={region}
                onValueChange={(v) => {
                  if (!v) return;
                  setRegion(v);
                  if (v !== 'US') setUsState('');
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {region === 'US' && (
              <div className="space-y-2">
                <Label>{t('step2.state')}</Label>
                <Select
                  items={stateItems}
                  value={usState || 'nationwide'}
                  onValueChange={(v) => setUsState(!v || v === 'nationwide' ? '' : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nationwide">{t('step2.nationwide')}</SelectItem>
                    {US_STATES.map((s) => (
                      <SelectItem key={s.code} value={s.code}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('step2.stateHint')}</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t('step2.language')}</Label>
              <Select
                items={LANGUAGE_ITEMS}
                value={language}
                onValueChange={(v) => v && setLanguage(v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full"
              onClick={guard(handleCreateBrand, { action: tActions('addBrands') })}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('step2.settingUp')}
                </>
              ) : (
                t('continue')
              )}
            </Button>
          </div>
        </div>

        <div className="flex w-full max-w-md items-center justify-between">
          <button
            onClick={() => setStep(1)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <StepDots current={2} total={TOTAL_STEPS} />
          <div className="w-12" />
        </div>
      </div>
    );
  }

  // ── Step 3: Topic Selection ──

  if (step === 3) {
    return (
      <div className="flex min-h-svh flex-col p-6 md:p-10">
        <div className="mx-auto w-full max-w-4xl flex-1">
          <BrandHeader name={brandName} domain={domain} />

          <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">
            <div className="lg:col-span-3 space-y-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">{t('step3.title')}</h1>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm text-muted-foreground">{t('step3.selectUpTo')}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{
                        width: `${(selectedTopics.size / 10) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              {loadingTopics ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
                  <Sparkles className="h-5 w-5 animate-pulse" />
                  <span key={topicLoadingMsg} className="text-sm animate-in fade-in duration-500">
                    {topicLoadingMsg}
                  </span>
                </div>
              ) : (
                <div className="space-y-2">
                  {topicSuggestError && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                      <span>{t('step3.suggestError')}</span>
                      <Button variant="outline" size="sm" onClick={fetchTopicSuggestions}>
                        {t('tryAgain')}
                      </Button>
                    </div>
                  )}
                  {suggestedTopics.map((topic) => {
                    const isSelected = selectedTopics.has(topic);
                    return (
                      <button
                        key={topic}
                        onClick={() => toggleTopic(topic)}
                        className={cn(
                          'flex items-center gap-3 w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-muted-foreground/30',
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                            isSelected
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/30',
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                        {topic}
                      </button>
                    );
                  })}

                  <div className="flex items-center gap-2 pt-2">
                    <Input
                      placeholder={t('step3.customPlaceholder')}
                      maxLength={BRAND_SETUP_LIMITS.topic}
                      value={customTopic}
                      onChange={(e) => setCustomTopic(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCustomTopic()}
                      className="text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addCustomTopic}
                      disabled={!customTopic.trim()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}

              <Button
                className="w-full"
                disabled={selectedTopics.size === 0 || loadingPrompts || loadingTopics}
                onClick={handleGeneratePrompts}
              >
                {loadingPrompts ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('step3.generating')}
                  </>
                ) : (
                  t('step3.looksGood')
                )}
              </Button>
            </div>

            <div className="lg:col-span-2">
              <div className="rounded-xl border bg-card p-5 sticky top-10">
                <h3 className="text-sm font-semibold mb-4">{t('step3.tipsTitle')}</h3>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{t('step3.tip1Title')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('step3.tip1Body')}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{t('step3.tip2Title')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('step3.tip2Body')}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">{t('step3.tip3Title')}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{t('step3.tip3Body')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
          <button
            onClick={() => setStep(2)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <StepDots current={3} total={TOTAL_STEPS} />
          <div className="w-12" />
        </div>
      </div>
    );
  }

  // ── Step 4: Prompt Review ──

  if (step === 4) {
    return (
      <div className="flex min-h-svh flex-col p-6 md:p-10">
        <div className="mx-auto w-full max-w-4xl flex-1">
          <BrandHeader name={brandName} domain={domain} />

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{tPrompts('title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{tPrompts('intro')}</p>
          </div>

          {overPrompts > 0 && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              {tWaiting('brandNote', { room: promptLimit ?? 0, count: overPrompts })}
            </div>
          )}

          {saveError && (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
              {saveError}
            </div>
          )}

          <div className="mb-4">
            <p className="text-sm font-medium">{t('step4.listTitle')}</p>
            <p data-slot="prompt-count" className="text-xs text-muted-foreground">
              {tPrompts('count', { picked: totalPrompts, total: offeredPrompts })}
            </p>
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
              <span className="flex-1">{t('step4.topicColumn')}</span>
            </div>
            {topicPrompts.map((tp, idx) => (
              <TopicAccordion
                key={`${tp.topic}-${idx}`}
                data={tp}
                defaultOpen={idx === 0}
                onRemoveTopic={() => removeTopic(idx)}
                onAddPrompt={(p) => addPromptToTopic(idx, p)}
                onTogglePrompt={(pi) => togglePrompt(idx, pi)}
              />
            ))}
            {topicPrompts.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t('step4.noPrompts')}
              </div>
            )}
          </div>

          <Button
            className="mt-6 w-full"
            onClick={handleSavePromptsAndContinue}
            disabled={isLoading || totalPrompts === 0}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('step4.saving')}
              </>
            ) : (
              t('continue')
            )}
          </Button>
        </div>

        <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
          <button
            onClick={() => setStep(3)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <StepDots current={4} total={TOTAL_STEPS} />
          <div className="w-12" />
        </div>
      </div>
    );
  }

  // ── Step 5: Competitors ──

  if (step === 5) {
    const selectedCompetitorCount = suggestedCompetitors.filter((c) => c.selected).length;

    return (
      <div className="flex min-h-svh flex-col p-6 md:p-10">
        <div className="mx-auto w-full max-w-lg flex-1">
          <BrandHeader name={brandName} domain={domain} />

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{t('step5.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('step5.subtitle')}</p>
          </div>

          {ecommerceDetected && <EcommerceNote brandName={brandName.trim()} />}

          {/* First, and outside the loading state: people arrive knowing their
              rivals and should not have to wait for, or scroll past, ours. */}
          <div className="mb-6 space-y-2">
            <p className="text-sm text-muted-foreground">{t('step5.manualPrompt')}</p>
            <div className="flex items-center gap-2">
              <Input
                placeholder={t('step5.namePlaceholder')}
                value={competitorName}
                onChange={(e) => setCompetitorName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManualCompetitor()}
                className="text-sm"
              />
              <Input
                placeholder={t('step5.domainPlaceholder')}
                value={competitorDomain}
                onChange={(e) => setCompetitorDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManualCompetitor()}
                className="text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={addManualCompetitor}
                disabled={!competitorName.trim()}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {loadingCompetitors ? (
            <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
              <Sparkles className="h-5 w-5 animate-pulse" />
              <span key={competitorLoadingMsg} className="text-sm animate-in fade-in duration-500">
                {competitorLoadingMsg}
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {competitorSuggestError && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
                  <span>{t('step5.suggestError')}</span>
                  <Button variant="outline" size="sm" onClick={fetchCompetitorSuggestions}>
                    {t('tryAgain')}
                  </Button>
                </div>
              )}
              {suggestedCompetitors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('step5.toTrack')}
                  </p>
                  {suggestedCompetitors.map((c, idx) => (
                    <div
                      key={`${c.domain}-${idx}`}
                      className={cn(
                        'flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors',
                        c.selected
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border hover:bg-muted/50',
                      )}
                      onClick={() => toggleCompetitor(idx)}
                    >
                      <div
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                          c.selected
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30',
                        )}
                      >
                        {c.selected && <Check className="h-3 w-3" />}
                      </div>
                      {c.domain && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={getFaviconUrl(c.domain)}
                          alt=""
                          className="h-5 w-5 rounded-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.name}</p>
                        {c.domain && (
                          <p className="text-xs text-muted-foreground truncate">{c.domain}</p>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCompetitor(idx);
                        }}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Button className="w-full" onClick={handleFinish} disabled={savingCompetitors}>
                {savingCompetitors ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('step5.finishing')}
                  </>
                ) : selectedCompetitorCount > 0 ? (
                  t('step5.start', { count: selectedCompetitorCount })
                ) : (
                  t('step5.skip')
                )}
              </Button>
            </div>
          )}
        </div>

        <div className="flex mx-auto w-full max-w-lg items-center justify-between mt-8">
          <button
            onClick={() => setStep(4)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <StepDots current={5} total={TOTAL_STEPS} />
          <div className="w-12" />
        </div>
      </div>
    );
  }

  return null;
}
