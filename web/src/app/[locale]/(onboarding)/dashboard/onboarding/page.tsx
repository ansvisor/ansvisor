'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { createClient } from '@/lib/supabase/client';
import { createBrand } from '@/lib/actions/brand';
import { createTopics, getTopics } from '@/lib/actions/topic';
import { savePromptSet } from '@/lib/actions/prompt';
import { triggerTrackingCheck } from '@/lib/actions/tracking';
import { addCompetitor, getCompetitors } from '@/lib/actions/competitor';
import { getFaviconUrl } from '@/lib/favicon';
import { useBrandStore } from '@/stores/use-brand-store';
import { REGIONS, LANGUAGES } from '@/config/prompt-options';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/prompt-options';
import { isCloud, PLANS, SUBSCRIBABLE_PLANS, getPlan, type PlanId } from '@/config/plans';
import { setPersonProperties, track } from '@/lib/analytics';

const ONBOARDING_STEP_NAMES: Record<number, string> = {
  1: 'brand_setup',
  2: 'brand_details',
  3: 'topics',
  4: 'prompts',
  5: 'competitors',
  6: 'plan',
};
import type { Brand } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  MoreHorizontal,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_BASE_URL } from '@/config/api';

const AEO_SERVER_URL = API_BASE_URL;

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

// ── Brand header (Steps 2-4) ───────────────────────────────────────────────────

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

// ── Topic Prompt Accordion ─────────────────────────────────────────────────────

interface TopicPromptsData {
  topic: string;
  prompts: string[];
}

function TopicAccordion({
  data,
  defaultOpen = false,
  onRemoveTopic,
  onAddPrompt,
  onRemovePrompt,
}: {
  data: TopicPromptsData;
  defaultOpen?: boolean;
  onRemoveTopic: () => void;
  onAddPrompt: (prompt: string) => void;
  onRemovePrompt: (index: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [newPrompt, setNewPrompt] = useState('');

  const handleAdd = () => {
    const trimmed = newPrompt.trim();
    if (trimmed.length >= 10) {
      onAddPrompt(trimmed);
      setNewPrompt('');
    }
  };

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-3 py-3 px-1">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 flex-1 text-left text-sm"
        >
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium">{data.topic}</span>
          <span className="text-xs text-muted-foreground">{data.prompts.length} prompts</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 rounded hover:bg-muted text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={onRemoveTopic}
            >
              Remove topic
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open && (
        <div className="pl-7 pb-3 space-y-1.5">
          {data.prompts.map((p, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 group rounded-md border bg-muted/30 px-3 py-2"
            >
              <span className="text-sm flex-1">{p}</span>
              <button
                onClick={() => onRemovePrompt(idx)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-2">
            <Input
              placeholder="Enter new prompt..."
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="text-sm h-9"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAdd}
              disabled={newPrompt.trim().length < 10}
              className="h-9 px-2"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewPrompt('')} className="h-9 px-2">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TOPIC_LOADING_MESSAGES = [
  'Researching topics for your brand...',
  'Analyzing your industry landscape...',
  'Identifying key themes and trends...',
  'Finding what your audience cares about...',
  'Evaluating competitive topics...',
  'Almost there, finalizing suggestions...',
];

const COMPETITOR_LOADING_MESSAGES = [
  'Searching for competitors...',
  'Analyzing your market...',
  'Identifying key players...',
  'Verifying company details...',
  'Finalizing recommendations...',
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { addBrand, setActiveBrand } = useBrandStore();

  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Step 1
  const [brandName, setBrandName] = useState('');
  const [website, setWebsite] = useState('');
  const [description, setDescription] = useState('');

  // Step 2
  const [region, setRegion] = useState('US');
  const [language, setLanguage] = useState('en');

  // Intermediate state
  const [createdBrand, setCreatedBrand] = useState<Brand | null>(null);

  // Step 3
  const [suggestedTopics, setSuggestedTopics] = useState<string[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [customTopic, setCustomTopic] = useState('');
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [topicLoadingMsg, setTopicLoadingMsg] = useState('');
  const topicMsgIdx = useRef(0);

  useEffect(() => {
    if (!loadingTopics) {
      topicMsgIdx.current = 0;
      return;
    }
    setTopicLoadingMsg(TOPIC_LOADING_MESSAGES[0]);
    topicMsgIdx.current = 0;

    const interval = setInterval(() => {
      topicMsgIdx.current = (topicMsgIdx.current + 1) % TOPIC_LOADING_MESSAGES.length;
      setTopicLoadingMsg(TOPIC_LOADING_MESSAGES[topicMsgIdx.current]);
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingTopics]);

  // Step 4
  const [topicPrompts, setTopicPrompts] = useState<TopicPromptsData[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);

  // Step 5
  interface CompetitorItem {
    name: string;
    domain: string;
    selected: boolean;
  }
  const [suggestedCompetitors, setSuggestedCompetitors] = useState<CompetitorItem[]>([]);
  const [loadingCompetitors, setLoadingCompetitors] = useState(false);
  const [competitorName, setCompetitorName] = useState('');
  const [competitorDomain, setCompetitorDomain] = useState('');
  const [savingCompetitors, setSavingCompetitors] = useState(false);
  const [competitorLoadingMsg, setCompetitorLoadingMsg] = useState('');
  const competitorMsgIdx = useRef(0);

  // Step 6 (cloud only)
  const [checkoutLoading, setCheckoutLoading] = useState<PlanId | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<PlanId>('starter');

  const totalSteps = isCloud() ? 6 : 5;

  // Determine which scrapers/models are available based on the plan
  const currentPlan = getPlan(currentPlanId);
  const allowedScraperIds = currentPlan.limits.allowedScrapers;
  const activeScrapers = allowedScraperIds
    ? ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id))
    : ALL_SCRAPERS;
  const allowedModelIds = currentPlan.limits.allowedModels;
  const activeModels = allowedModelIds
    ? ALL_MODELS.filter((m) => allowedModelIds.includes(m.id))
    : ALL_MODELS;

  useEffect(() => {
    if (!loadingCompetitors) {
      competitorMsgIdx.current = 0;
      return;
    }
    setCompetitorLoadingMsg(COMPETITOR_LOADING_MESSAGES[0]);
    competitorMsgIdx.current = 0;

    const interval = setInterval(() => {
      competitorMsgIdx.current =
        (competitorMsgIdx.current + 1) % COMPETITOR_LOADING_MESSAGES.length;
      setCompetitorLoadingMsg(COMPETITOR_LOADING_MESSAGES[competitorMsgIdx.current]);
    }, 2500);

    return () => clearInterval(interval);
  }, [loadingCompetitors]);

  // Auto-fetch competitor suggestions when arriving at step 5 with none loaded
  useEffect(() => {
    if (
      step === 5 &&
      !initialLoading &&
      !loadingCompetitors &&
      suggestedCompetitors.length === 0 &&
      createdBrand
    ) {
      fetchCompetitorSuggestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, initialLoading]);

  // Resume logic: check existing state on mount
  useEffect(() => {
    async function checkResume() {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
          .from('profiles')
          .select('organization_id, onboarding_completed')
          .eq('id', user.id)
          .single();

        if (profile?.onboarding_completed) {
          if (isCloud() && profile.organization_id) {
            // Check subscription status — if not active/trialing, show plan selection
            const { data: org } = await supabase
              .from('organizations')
              .select('subscription_status, plan')
              .eq('id', profile.organization_id)
              .single();
            if (org?.plan) setCurrentPlanId(org.plan as PlanId);
            const subStatus = org?.subscription_status;
            if (subStatus !== 'active' && subStatus !== 'trialing') {
              setOrganizationId(profile.organization_id);
              setStep(6);
              setInitialLoading(false);
              return;
            }
          }
          router.push('/dashboard');
          router.refresh();
          return;
        }

        if (profile?.organization_id) {
          setOrganizationId(profile.organization_id);
          const { data: brands } = await supabase
            .from('brands')
            .select('*, brand_domains(*)')
            .eq('organization_id', profile.organization_id)
            .limit(1);

          if (brands?.length) {
            const b = brands[0];
            const mapped: Brand = {
              id: b.id,
              organizationId: b.organization_id,
              name: b.name,
              slug: b.slug,
              logoUrl: b.logo_url ?? undefined,
              industry: b.industry ?? undefined,
              description: b.description ?? undefined,
              region: b.region ?? undefined,
              language: b.language ?? undefined,
              shoppingModeEnabled: !!b.shopping_mode_enabled,
              isActive: (b as { is_active?: boolean }).is_active ?? true,
              domains: (b.brand_domains || []).map((d: Record<string, unknown>) => ({
                id: d.id as string,
                brandId: d.brand_id as string,
                domain: d.domain as string,
                country: (d.country as string) ?? undefined,
                isPrimary: d.is_primary as boolean,
              })),
              createdAt: b.created_at,
              updatedAt: b.updated_at,
            };
            setCreatedBrand(mapped);
            addBrand(mapped);
            setActiveBrand(mapped.id);
            setBrandName(mapped.name);
            setWebsite(mapped.domains[0]?.domain || '');
            setDescription(mapped.description || '');
            setRegion(mapped.region || 'US');
            setLanguage(mapped.language || 'en');

            const topics = await getTopics(mapped.id);
            if (topics.length > 0) {
              const { data: promptSets } = await supabase
                .from('prompt_sets')
                .select('id')
                .eq('brand_id', mapped.id);

              if (promptSets?.length) {
                // Prompts exist — go to step 5 (competitors)
                const existingCompetitors = await getCompetitors(mapped.id);
                if (existingCompetitors.length > 0) {
                  setSuggestedCompetitors(
                    existingCompetitors.map((c) => ({
                      name: c.name,
                      domain: c.domain,
                      selected: true,
                    })),
                  );
                }
                setStep(5);
              } else {
                setStep(3);
                setSuggestedTopics(topics.map((t) => t.name));
                setSelectedTopics(new Set(topics.map((t) => t.name)));
              }
            } else {
              setStep(3);
            }
          }
        }
      } catch (err) {
        console.error('Resume check failed:', err);
      } finally {
        setInitialLoading(false);
      }
    }
    checkResume();
  }, [router, addBrand, setActiveBrand]);

  // Fire `onboarding_step_viewed` whenever the wizard advances (or resumes).
  // This is the funnel surface — PostHog will compute drop-off between any
  // two adjacent step_viewed events without us needing per-step columns.
  useEffect(() => {
    const stepName = ONBOARDING_STEP_NAMES[step];
    if (stepName) {
      track('onboarding_step_viewed', { step, step_name: stepName });
    }
  }, [step]);

  const domain = website
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .trim();

  // ── Step 2 → Step 3 transition: create org + brand ──

  const handleCreateOrgAndBrand = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Check if org already exists (resume case)
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      let orgId = profile?.organization_id;

      if (!orgId) {
        const slug =
          brandName
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || `org-${Date.now()}`;

        const { data: existing } = await supabase
          .from('organizations')
          .select('id')
          .eq('slug', slug)
          .maybeSingle();

        const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

        const { data: org, error: orgError } = await supabase
          .from('organizations')
          .insert({ name: brandName.trim(), slug: finalSlug })
          .select()
          .single();

        if (orgError || !org) throw new Error(orgError?.message ?? 'Failed to create organization');

        const { error: profileError } = await supabase
          .from('profiles')
          .update({ organization_id: org.id })
          .eq('id', user.id);

        if (profileError) throw new Error(profileError.message);
        orgId = org.id;
      }

      setOrganizationId(orgId);

      // Create brand if not already created
      if (!createdBrand) {
        const logoUrl = domain ? getFaviconUrl(domain) : undefined;

        const brand = await createBrand({
          organizationId: orgId,
          name: brandName.trim(),
          logoUrl,
          description: description.trim() || undefined,
          region,
          language,
          domains: domain ? [{ domain, isPrimary: true }] : [],
        });

        setCreatedBrand(brand);
        addBrand(brand);
        setActiveBrand(brand.id);
        track('onboarding_brand_created', { region: brand.region });
        track('onboarding_step_completed', {
          step: 2,
          step_name: 'brand_details',
          region: brand.region,
          language: brand.language,
        });
        setPersonProperties({
          region: brand.region,
          language: brand.language,
        });
      }

      setStep(3);

      // Auto-suggest topics
      if (suggestedTopics.length === 0) {
        fetchTopicSuggestions();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create brand');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Topic suggestion ──

  const fetchTopicSuggestions = async () => {
    setLoadingTopics(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(`${AEO_SERVER_URL}/api/topics/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          brandName: brandName.trim(),
          industry: '',
          description: description.trim(),
          website: domain,
          language,
        }),
      });

      if (!res.ok) throw new Error('Failed to suggest topics');
      const data = await res.json();

      const names = (data.topics || []).map((t: { name: string }) => t.name);
      setSuggestedTopics(names);
      setSelectedTopics(new Set(names.slice(0, 7)));
    } catch (err) {
      console.error('Topic suggestion error:', err);
      toast.error('Failed to generate topic suggestions');
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
      // Save topics to DB
      const topicNames = Array.from(selectedTopics);
      await createTopics(createdBrand.id, topicNames);

      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(`${AEO_SERVER_URL}/api/prompts/from-topics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          brandName: brandName.trim(),
          industry: '',
          description: description.trim(),
          topics: topicNames,
          language,
        }),
      });

      if (!res.ok) throw new Error('Failed to generate prompts');
      const data = await res.json();

      setTopicPrompts(
        (data.topicPrompts || []).map((tp: { topic: string; prompts: string[] }) => ({
          topic: tp.topic,
          prompts: tp.prompts,
        })),
      );
      track('onboarding_step_completed', {
        step: 3,
        step_name: 'topics',
        topic_count: selectedTopics.size,
      });
      setStep(4);
    } catch (err) {
      console.error('Prompt generation error:', err);
      toast.error('Failed to generate prompts from topics');
    } finally {
      setLoadingPrompts(false);
    }
  };

  // ── Step 4 → Step 5: save prompts + fetch competitors ──

  const handleSavePromptsAndContinue = async () => {
    if (!createdBrand) return;
    setIsLoading(true);
    try {
      const allPrompts = topicPrompts.flatMap((tp) =>
        tp.prompts.map((text) => ({
          text,
          category: tp.topic,
          platforms: activeScrapers.map((s) => s.id),
          models: activeModels.map((m) => m.id),
          isActive: true,
        })),
      );

      if (allPrompts.length === 0) {
        toast.error('Add at least one prompt before continuing');
        setIsLoading(false);
        return;
      }

      await savePromptSet({
        brandId: createdBrand.id,
        name: 'Onboarding Prompts',
        prompts: allPrompts,
      });
      track('onboarding_prompts_saved', { count: allPrompts.length });
      track('onboarding_step_completed', {
        step: 4,
        step_name: 'prompts',
        prompt_count: allPrompts.length,
        topic_count: topicPrompts.length,
      });

      setStep(5);
      fetchCompetitorSuggestions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompts');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Competitor suggestion ──

  const fetchCompetitorSuggestions = async () => {
    setLoadingCompetitors(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(`${AEO_SERVER_URL}/api/competitors/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          brandName: brandName.trim(),
          industry: '',
          description: description.trim(),
          language,
        }),
      });

      if (!res.ok) throw new Error('Failed to suggest competitors');
      const data = await res.json();

      setSuggestedCompetitors(
        (data.competitors || []).map((c: { name: string; domain: string }) => ({
          name: c.name,
          domain: c.domain,
          selected: true,
        })),
      );
    } catch (err) {
      console.error('Competitor suggestion error:', err);
      toast.error('Failed to generate competitor suggestions');
    } finally {
      setLoadingCompetitors(false);
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
    const name = competitorName.trim();
    const domain = competitorDomain
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (!name) return;
    setSuggestedCompetitors((prev) => [...prev, { name, domain, selected: true }]);
    setCompetitorName('');
    setCompetitorDomain('');
  };

  // ── Step 5: final save ──

  const handleFinish = async () => {
    if (!createdBrand) return;
    setSavingCompetitors(true);
    try {
      // Save selected competitors
      const selected = suggestedCompetitors.filter((c) => c.selected);
      if (selected.length > 0) {
        await Promise.all(
          selected.map((c) => addCompetitor(createdBrand.id, { name: c.name, domain: c.domain })),
        );
      }

      // Mark onboarding as complete
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id);
      }

      const competitorCount = selected.length;
      track('onboarding_step_completed', {
        step: 5,
        step_name: 'competitors',
        competitor_count: competitorCount,
      });
      setPersonProperties({
        onboarding_completed: true,
      });

      // Cloud mode → proceed to subscription step (tracking triggered after payment)
      if (isCloud()) {
        toast.success('Almost done! Choose a plan to start your free trial.');
        setSavingCompetitors(false);
        setStep(6);
        return;
      }

      track('onboarding_finished', { paid: false });

      // Self-hosted: trigger tracking immediately
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
        // Non-critical — tracking will run on schedule
      }

      toast.success('Setup complete! Your first tracking is starting.');

      // Full page navigation bypasses Next.js router cache, ensuring
      // the server-side layout reads the fresh onboarding_completed flag.
      window.location.href = '/dashboard/insights';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save competitors');
      setSavingCompetitors(false);
    }
  };

  // ── Step 6: Stripe checkout ──

  const handleCheckout = async (planId: PlanId) => {
    if (!organizationId) return;
    setCheckoutLoading(planId);
    track('onboarding_step_completed', {
      step: 6,
      step_name: 'plan',
      plan_id: planId,
    });
    track('onboarding_plan_selected', { plan_id: planId });
    setPersonProperties({
      intended_plan: planId,
    });
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, organizationId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create checkout session');
      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed');
      setCheckoutLoading(null);
    }
  };

  // ── Topic prompt editing helpers ──

  const removeTopic = (index: number) => {
    setTopicPrompts((prev) => prev.filter((_, i) => i !== index));
  };

  const addPromptToTopic = (topicIndex: number, prompt: string) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) => (i === topicIndex ? { ...tp, prompts: [...tp.prompts, prompt] } : tp)),
    );
  };

  const removePromptFromTopic = (topicIndex: number, promptIndex: number) => {
    setTopicPrompts((prev) =>
      prev.map((tp, i) =>
        i === topicIndex
          ? { ...tp, prompts: tp.prompts.filter((_, pi) => pi !== promptIndex) }
          : tp,
      ),
    );
  };

  const totalPrompts = topicPrompts.reduce((sum, tp) => sum + tp.prompts.length, 0);

  // ── Loading state ──

  if (initialLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Step 1: Brand Info ──

  if (step === 1) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Globe className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Set up your brand</h1>
            <p className="text-sm text-muted-foreground">
              See how AI platforms talk about you. Add your first brand to get started.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="brandName">Brand name</Label>
              <Input
                id="brandName"
                placeholder="e.g. Acme Corp"
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="website">Website</Label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-md border border-r-0 bg-muted px-3 text-sm text-muted-foreground">
                  https://
                </span>
                <Input
                  id="website"
                  placeholder="example.com"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="rounded-l-none"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                Describe your brand <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="description"
                placeholder="A brief description helps us generate better suggestions."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
              <ul className="text-xs text-muted-foreground space-y-1 list-disc ml-4">
                <li>What industry are you in?</li>
                <li>Who is your target audience?</li>
              </ul>
            </div>

            <Button
              className="w-full"
              disabled={!brandName.trim() || !website.trim()}
              onClick={() => {
                track('onboarding_step_completed', {
                  step: 1,
                  step_name: 'brand_setup',
                  brand_name: brandName.trim(),
                  brand_domain: domain,
                  has_description: description.trim().length > 0,
                });
                setPersonProperties({
                  company_url: domain,
                });
                setStep(2);
              }}
            >
              Continue
            </Button>
          </div>
        </div>

        <StepDots current={1} total={totalSteps} />
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
            <h1 className="text-2xl font-bold tracking-tight">Select your target market</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Pick the region and language your audience uses. This helps us deliver more accurate
              AI visibility data.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={region} onValueChange={(v) => v && setRegion(v)}>
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

            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={(v) => v && setLanguage(v)}>
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

            <Button className="w-full" onClick={handleCreateOrgAndBrand} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Setting up...
                </>
              ) : (
                'Continue'
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
            Back
          </button>
          <StepDots current={2} total={totalSteps} />
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
                <h1 className="text-2xl font-bold tracking-tight">Choose topics to monitor</h1>
                <div className="flex items-center gap-2 mt-3">
                  <span className="text-sm text-muted-foreground">Select up to 10 topics</span>
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
                      placeholder="Add custom topic..."
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
                    Generating prompts...
                  </>
                ) : (
                  'Looks good'
                )}
              </Button>
            </div>

            <div className="lg:col-span-2">
              <div className="rounded-xl border bg-card p-5 sticky top-10">
                <h3 className="text-sm font-semibold mb-4">Topic Selection Tips</h3>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">5 prompts are created per topic</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        You can select up to 10 topics for a total of 50 prompts. More can be added
                        anytime from the dashboard.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Think like your customers</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Use terms your audience would search for when looking for products or
                        services like yours.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Check className="h-4 w-4 text-foreground shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Keep it short</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Topics should be concise — we&apos;ll turn them into detailed prompts in the
                        next step.
                      </p>
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
            Back
          </button>
          <StepDots current={3} total={totalSteps} />
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

          <div className="flex items-start justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Review your prompts</h1>
              <p className="text-sm text-muted-foreground mt-1">
                These prompts will be sent to AI platforms daily. Feel free to edit, add, or remove
                any before starting.
              </p>
            </div>
            <Button
              onClick={handleSavePromptsAndContinue}
              disabled={isLoading || totalPrompts === 0}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving prompts...
                </>
              ) : (
                'Continue'
              )}
            </Button>
          </div>

          <div className="mb-4">
            <p className="text-sm font-medium">Your Prompt List</p>
            <p className="text-xs text-muted-foreground">{totalPrompts} prompts total</p>
          </div>

          <div className="rounded-lg border">
            <div className="flex items-center gap-4 px-4 py-2.5 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
              <span className="flex-1">Topic</span>
            </div>
            {topicPrompts.map((tp, idx) => (
              <TopicAccordion
                key={`${tp.topic}-${idx}`}
                data={tp}
                defaultOpen={idx === 0}
                onRemoveTopic={() => removeTopic(idx)}
                onAddPrompt={(p) => addPromptToTopic(idx, p)}
                onRemovePrompt={(pi) => removePromptFromTopic(idx, pi)}
              />
            ))}
            {topicPrompts.length === 0 && (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No prompts generated yet.
              </div>
            )}
          </div>
        </div>

        <div className="flex mx-auto w-full max-w-4xl items-center justify-between mt-8">
          <button
            onClick={() => setStep(3)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </button>
          <StepDots current={4} total={totalSteps} />
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
            <h1 className="text-2xl font-bold tracking-tight">Add your competitors</h1>
            <p className="text-sm text-muted-foreground mt-1">
              We&apos;ll track how often competitors appear alongside your brand in AI responses.
            </p>
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
              {suggestedCompetitors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Suggested competitors
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

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Add manually
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="Company name"
                    value={competitorName}
                    onChange={(e) => setCompetitorName(e.target.value)}
                    className="text-sm"
                  />
                  <Input
                    placeholder="domain.com"
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

              <Button className="w-full" onClick={handleFinish} disabled={savingCompetitors}>
                {savingCompetitors ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Finishing setup...
                  </>
                ) : selectedCompetitorCount > 0 ? (
                  `Start tracking with ${selectedCompetitorCount} competitor${selectedCompetitorCount !== 1 ? 's' : ''}`
                ) : (
                  'Skip & start tracking'
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
            Back
          </button>
          <StepDots current={5} total={totalSteps} />
          <div className="w-12" />
        </div>
      </div>
    );
  }

  // ── Step 6: Choose Plan (cloud only) ──

  if (step !== 6) return null;

  return (
    <div className="flex min-h-svh flex-col p-6 md:p-10">
      <div className="mx-auto w-full max-w-2xl flex-1">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold tracking-tight">Choose your plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Start with a 14-day free trial. Cancel anytime.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 sm:grid-cols-2">
          {SUBSCRIBABLE_PLANS.map((planId) => {
            const plan = PLANS[planId];
            const price = plan.pricing;
            if (!price) return null;

            const loading = checkoutLoading === planId;

            return (
              <div
                key={planId}
                className={cn(
                  'relative flex flex-col rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md',
                  plan.highlighted && 'border-primary shadow-md ring-1 ring-primary/20',
                )}
              >
                {plan.highlighted && (
                  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most Popular</Badge>
                )}

                <div className="mb-4">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
                </div>

                <div className="flex items-end gap-1 mb-4">
                  <span className="text-4xl font-bold tracking-tight">${price.monthly}</span>
                  <span className="mb-1 text-sm text-muted-foreground">/month</span>
                </div>

                <Button
                  className="w-full"
                  variant={plan.highlighted ? 'default' : 'outline'}
                  onClick={() => handleCheckout(planId)}
                  disabled={checkoutLoading !== null}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Redirecting...
                    </>
                  ) : (
                    'Start Free Trial'
                  )}
                </Button>

                <Separator className="my-5" />

                <div className="flex-1 space-y-2.5 text-sm">
                  <PlanFeatureItem>
                    <strong>
                      {plan.limits.maxBrands === -1 ? 'Unlimited' : plan.limits.maxBrands}
                    </strong>{' '}
                    {plan.limits.maxBrands === 1 ? 'brand' : 'brands'}
                  </PlanFeatureItem>
                  <PlanFeatureItem>
                    <strong>
                      {plan.limits.maxPrompts === -1 ? 'Unlimited' : plan.limits.maxPrompts}
                    </strong>{' '}
                    prompts tracked
                  </PlanFeatureItem>
                  <PlanFeatureItem>
                    <strong>{plan.limits.maxPlatforms}</strong> answer engines
                    {plan.limits.allowedScrapers && plan.limits.allowedScrapers.length > 0 && (
                      <span className="text-muted-foreground font-normal">
                        {' '}
                        (
                        {plan.limits.allowedScrapers
                          .map((id) => {
                            const s = ALL_SCRAPERS.find((s) => s.id === id);
                            return s ? s.label.replace(/\s*\(Web\)/i, '') : id;
                          })
                          .join(' & ')}
                        )
                      </span>
                    )}
                  </PlanFeatureItem>
                  {plan.limits.maxTeamMembers > 1 && (
                    <PlanFeatureItem>
                      <strong>{plan.limits.maxTeamMembers}</strong> team members
                    </PlanFeatureItem>
                  )}
                  <PlanFeatureItem>
                    {plan.limits.features.includes('daily_monitoring')
                      ? 'Daily monitoring'
                      : 'Weekly monitoring'}
                  </PlanFeatureItem>
                  {plan.limits.features.includes('competitor_tracking') && (
                    <PlanFeatureItem>Competitor tracking</PlanFeatureItem>
                  )}
                  {plan.limits.features.includes('content_optimization') && (
                    <PlanFeatureItem>Content optimization</PlanFeatureItem>
                  )}
                  {plan.limits.features.includes('advanced_analytics') && (
                    <PlanFeatureItem>Advanced analytics</PlanFeatureItem>
                  )}
                  <PlanFeatureItem>Email support</PlanFeatureItem>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Need more?{' '}
          <a href="mailto:sales@ansvisor.com" className="underline hover:text-foreground">
            Contact sales
          </a>{' '}
          for Enterprise pricing.
        </p>
      </div>

      <div className="flex mx-auto w-full max-w-2xl items-center justify-between mt-8">
        <button
          onClick={() => setStep(5)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>
        <StepDots current={6} total={totalSteps} />
        <div className="w-12" />
      </div>
    </div>
  );
}

function PlanFeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <span>{children}</span>
    </div>
  );
}
