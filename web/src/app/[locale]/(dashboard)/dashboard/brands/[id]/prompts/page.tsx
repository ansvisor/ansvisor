'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  getPromptSets,
  savePromptSet,
  addPromptToSet,
  updatePrompt,
  deletePrompt,
} from '@/lib/actions/prompt';
import { getBrandById } from '@/lib/actions/brand';
import { getTopics } from '@/lib/actions/topic';
import { PromptSuggestionCard } from '@/components/dashboard/prompt-suggestion-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Sparkles, Save, X, Play, Search, Lock } from 'lucide-react';
import { MODEL_GROUPS, ALL_MODELS, SCRAPER_GROUPS, ALL_SCRAPERS } from '@/config/prompt-options';
import { usePlanContext } from '@/components/providers/plan-provider';
import { useUserRole } from '@/hooks/use-user-role';
import { PLANS } from '@/config/plans';
import { saveTrackingJob } from '@/lib/tracking-job-store';
import { useRouter } from '@/i18n/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import type { Brand, Prompt, PromptSet, Topic } from '@/types';

interface UnanalyzedPrompt {
  id: string;
  text: string;
  category: string;
}

const AEO_SERVER_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:80';

interface SuggestedPrompt {
  text: string;
  category: string;
  isActive: boolean;
}

export default function PromptsPage() {
  const params = useParams();
  const brandId = params.id as string;
  const router = useRouter();

  const [brand, setBrand] = useState<Brand | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [promptSets, setPromptSets] = useState<PromptSet[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [manualText, setManualText] = useState('');
  const [manualCategory, setManualCategory] = useState('');
  const [generateTopics, setGenerateTopics] = useState<string[] | null>(null);
  const { planId } = usePlanContext();
  const { canManage } = useUserRole();
  const allowedScraperIds = useMemo(() => {
    const allowed = PLANS[planId].limits.allowedScrapers;
    return allowed ? [...allowed] : ALL_SCRAPERS.map((s) => s.id);
  }, [planId]);
  const allowedModelIds = useMemo(() => {
    const allowed = PLANS[planId].limits.allowedModels;
    return allowed ? [...allowed] : ALL_MODELS.map((m) => m.id);
  }, [planId]);
  const visibleScrapers = useMemo(
    () => ALL_SCRAPERS.filter((s) => allowedScraperIds.includes(s.id)),
    [allowedScraperIds],
  );
  const visibleModels = useMemo(
    () => ALL_MODELS.filter((m) => allowedModelIds.includes(m.id)),
    [allowedModelIds],
  );
  const [manualModels, setManualModels] = useState<string[]>(allowedModelIds);
  const [manualScrapers, setManualScrapers] = useState<string[]>(allowedScraperIds);
  const [isAddingManual, setIsAddingManual] = useState(false);
  const [unanalyzedPrompts, setUnanalyzedPrompts] = useState<UnanalyzedPrompt[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeDialogOpen, setAnalyzeDialogOpen] = useState(false);
  const [selectedAnalyzeIds, setSelectedAnalyzeIds] = useState<Set<string>>(new Set());
  const [isLoadingUnanalyzed, setIsLoadingUnanalyzed] = useState(false);

  // Flatten all prompts from all sets, sorted newest first
  const allPrompts = useMemo(() => {
    return promptSets
      .flatMap((set) => set.prompts)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [promptSets]);

  const fetchUnanalyzed = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/unanalyzed/${brandId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUnanalyzedPrompts(data.prompts ?? []);
      }
    } catch {}
  }, [brandId]);

  const loadData = useCallback(async () => {
    try {
      const [brandData, sets, topicsData] = await Promise.all([
        getBrandById(brandId),
        getPromptSets(brandId),
        getTopics(brandId),
      ]);
      setBrand(brandData);
      setTopics(topicsData);
      if (topicsData.length > 0 && !manualCategory) {
        setManualCategory(topicsData[0].name);
      }
      setGenerateTopics((prev) => (prev === null ? topicsData.map((t) => t.name) : prev));
      setPromptSets(sets);
    } catch {
      toast.error('Failed to load data');
    } finally {
      setIsLoading(false);
    }
    fetchUnanalyzed();
  }, [brandId, manualCategory, fetchUnanalyzed]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleGenerate = async () => {
    if (!brand) return;
    if (!generateTopics || generateTopics.length === 0) {
      toast.error('Select at least one topic to generate prompts');
      return;
    }

    setIsGenerating(true);
    setSuggestions([]);

    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(`${AEO_SERVER_URL}/api/prompts/from-topics`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          brandName: brand.name,
          industry: brand.industry || undefined,
          description: brand.description || undefined,
          topics: generateTopics,
          language: brand.language || 'en',
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error (${response.status})`);
      }

      const data = await response.json();
      const allPrompts: SuggestedPrompt[] = [];
      for (const tp of data.topicPrompts ?? []) {
        for (const text of tp.prompts) {
          allPrompts.push({ text, category: tp.topic, isActive: true });
        }
      }
      setSuggestions(allPrompts);
      toast.success(`${allPrompts.length} prompt suggestions generated!`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate suggestions');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveSuggestions = async () => {
    const activePrompts = suggestions.filter((s) => s.isActive);
    if (activePrompts.length === 0) {
      toast.error('Select at least one prompt to save');
      return;
    }

    setIsSaving(true);
    try {
      const defaultPlatforms = allowedScraperIds;
      const defaultModels = allowedModelIds;

      let targetSetId = promptSets[0]?.id;

      if (!targetSetId) {
        const newSet = await savePromptSet({
          brandId,
          name: 'Prompts',
          prompts: activePrompts.map((p) => ({
            text: p.text,
            category: p.category,
            platforms: defaultPlatforms,
            models: defaultModels,
          })),
        });
        targetSetId = newSet.id;
      } else {
        await Promise.all(
          activePrompts.map((p) =>
            addPromptToSet({
              promptSetId: targetSetId,
              text: p.text,
              category: p.category,
              platforms: defaultPlatforms,
              models: defaultModels,
            }),
          ),
        );
      }

      setSuggestions([]);
      toast.success(`Saved ${activePrompts.length} prompts`);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save prompts');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddManualPrompt = async () => {
    if (!manualText.trim()) return;

    setIsAddingManual(true);
    try {
      const existingSet = promptSets[0];

      const promptData = {
        text: manualText.trim(),
        category: manualCategory,
        platforms: manualScrapers,
        models: manualModels,
      };

      if (existingSet) {
        await addPromptToSet({
          promptSetId: existingSet.id,
          ...promptData,
        });
      } else {
        await savePromptSet({
          brandId,
          name: `Prompts`,
          prompts: [promptData],
        });
      }

      setManualText('');
      setManualModels(allowedModelIds);
      setManualScrapers(allowedScraperIds);
      toast.success('Prompt added');
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add prompt');
    } finally {
      setIsAddingManual(false);
    }
  };

  const updatePromptLocal = useCallback((promptId: string, patch: Partial<Prompt>) => {
    setPromptSets((prev) =>
      prev.map((set) => ({
        ...set,
        prompts: set.prompts.map((p) => (p.id === promptId ? { ...p, ...patch } : p)),
      })),
    );
  }, []);

  const removePromptLocal = useCallback((promptId: string) => {
    setPromptSets((prev) =>
      prev.map((set) => ({
        ...set,
        prompts: set.prompts.filter((p) => p.id !== promptId),
      })),
    );
  }, []);

  const handleTogglePrompt = useCallback(
    async (prompt: Prompt) => {
      updatePromptLocal(prompt.id, { isActive: !prompt.isActive });
      try {
        await updatePrompt(prompt.id, { isActive: !prompt.isActive });
      } catch {
        updatePromptLocal(prompt.id, { isActive: prompt.isActive });
        toast.error('Failed to update prompt');
      }
    },
    [updatePromptLocal],
  );

  const handleEditPrompt = useCallback(
    async (promptId: string, text: string) => {
      updatePromptLocal(promptId, { text });
      try {
        await updatePrompt(promptId, { text });
      } catch {
        toast.error('Failed to update prompt');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleCategoryChange = useCallback(
    async (promptId: string, category: string) => {
      updatePromptLocal(promptId, { category });
      try {
        await updatePrompt(promptId, { category });
      } catch {
        toast.error('Failed to update topic');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleModelsChange = useCallback(
    async (promptId: string, models: string[]) => {
      updatePromptLocal(promptId, { models });
      try {
        await updatePrompt(promptId, { models });
      } catch {
        toast.error('Failed to update models');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handlePlatformsChange = useCallback(
    async (promptId: string, platforms: string[]) => {
      updatePromptLocal(promptId, { platforms: platforms as Prompt['platforms'] });
      try {
        await updatePrompt(promptId, { platforms });
      } catch {
        toast.error('Failed to update platforms');
        await loadData();
      }
    },
    [updatePromptLocal, loadData],
  );

  const handleDeletePrompt = useCallback(
    async (promptId: string) => {
      removePromptLocal(promptId);
      try {
        await deletePrompt(promptId);
      } catch {
        toast.error('Failed to delete prompt');
        await loadData();
      }
    },
    [removePromptLocal, loadData],
  );

  const openAnalyzeDialog = useCallback(async () => {
    setAnalyzeDialogOpen(true);
    setIsLoadingUnanalyzed(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/unanalyzed/${brandId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
      });
      if (resp.ok) {
        const data = await resp.json();
        const prompts: UnanalyzedPrompt[] = data.prompts ?? [];
        setUnanalyzedPrompts(prompts);
        setSelectedAnalyzeIds(new Set(prompts.map((p) => p.id)));
      }
    } catch {
      toast.error('Failed to load unanalyzed prompts');
    } finally {
      setIsLoadingUnanalyzed(false);
    }
  }, [brandId]);

  const handleAnalyzeSelected = async () => {
    if (isAnalyzing || selectedAnalyzeIds.size === 0) return;
    setIsAnalyzing(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const resp = await fetch(`${AEO_SERVER_URL}/api/tracking/analyze-new`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          'ngrok-skip-browser-warning': '1',
        },
        body: JSON.stringify({ brandId, promptIds: Array.from(selectedAnalyzeIds) }),
      });

      const data = await resp.json();

      if (!resp.ok) {
        toast.error(data.message || 'Failed to start analysis');
        return;
      }

      if (data.newCount === 0) {
        toast.info(data.message || 'All prompts already analyzed');
      } else {
        toast.success(data.message || `Analyzing ${data.newCount} new prompts`);
        setUnanalyzedPrompts([]);
        setAnalyzeDialogOpen(false);
        saveTrackingJob({ jobId: data.jobId, brandId, startedAt: Date.now() });
        router.push('/dashboard/insights');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!brand) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <p className="text-muted-foreground">Brand not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Read-only banner — non-admin / non-manager roles can't INSERT into
          prompts / prompt_sets at the DB layer (RLS). We hide the write
          controls below so they don't hit a generic "Failed to save"
          toast after the request gets rejected. */}
      {!canManage && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-4 text-sm">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">Read-only access</p>
            <p className="mt-1 text-muted-foreground">
              Your role can view tracked prompts but not add, edit, or delete them. Ask an admin or
              manager to make changes.
            </p>
          </div>
        </div>
      )}

      {/* Add Prompt + AI Generate */}
      {canManage && (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Manual Add */}
          <Card id="add-prompt" className="scroll-mt-24">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" />
                Add Prompt
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Input
                  placeholder="e.g. Best project management tools for startups"
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && manualText.trim()) handleAddManualPrompt();
                  }}
                />

                <div className="space-y-3">
                  {/* Topic */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Topic
                    </label>
                    {topics.length > 0 ? (
                      <Select
                        value={manualCategory}
                        onValueChange={(v) => v && setManualCategory(v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a topic" />
                        </SelectTrigger>
                        <SelectContent>
                          {topics.map((topic) => (
                            <SelectItem key={topic.id} value={topic.name}>
                              {topic.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-xs text-muted-foreground py-2">
                        No topics defined yet. Add topics in brand settings.
                      </p>
                    )}
                  </div>

                  {/* Platform & Models — combined select */}
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Platform & Models
                    </label>
                    <Select
                      value="__placeholder__"
                      onValueChange={(v) => {
                        if (!v || v === '__placeholder__') return;
                        if (visibleModels.some((m) => m.id === v) && !manualModels.includes(v)) {
                          setManualModels((prev) => [...prev, v]);
                        } else if (
                          visibleScrapers.some((s) => s.id === v) &&
                          !manualScrapers.includes(v)
                        ) {
                          setManualScrapers((prev) => [...prev, v]);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <span className="truncate text-muted-foreground">
                          {manualModels.length + manualScrapers.length > 0
                            ? `${manualModels.length + manualScrapers.length} selected`
                            : 'Select platform & models'}
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        {SCRAPER_GROUPS.map((group) => {
                          const scrapers = group.scrapers.filter((s) =>
                            visibleScrapers.some((vs) => vs.id === s.id),
                          );
                          if (scrapers.length === 0) return null;
                          return (
                            <div key={group.provider}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                {group.provider} (Scraper)
                              </div>
                              {scrapers.map((s) => (
                                <SelectItem
                                  key={s.id}
                                  value={s.id}
                                  disabled={manualScrapers.includes(s.id)}
                                >
                                  <div>
                                    <div>{s.label}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {s.id}
                                    </div>
                                  </div>
                                </SelectItem>
                              ))}
                            </div>
                          );
                        })}
                        {MODEL_GROUPS.map((group) => {
                          const groupModels = group.models.filter((m) =>
                            visibleModels.some((vm) => vm.id === m.id),
                          );
                          if (groupModels.length === 0) return null;
                          return (
                            <div key={group.provider}>
                              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                                {group.provider} (API)
                              </div>
                              {groupModels.map((m) => (
                                <SelectItem
                                  key={m.id}
                                  value={m.id}
                                  disabled={manualModels.includes(m.id)}
                                >
                                  <div>
                                    <div>{m.label}</div>
                                    <div className="text-[10px] text-muted-foreground font-mono">
                                      {m.id}
                                    </div>
                                  </div>
                                </SelectItem>
                              ))}
                            </div>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(manualModels.length > 0 || manualScrapers.length > 0) && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {manualScrapers.map((id) => {
                          const s = ALL_SCRAPERS.find((as_) => as_.id === id);
                          return (
                            <Badge key={id} variant="outline" className="gap-1 text-xs">
                              {s?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setManualScrapers((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                        {manualModels.map((id) => {
                          const m = ALL_MODELS.find((am) => am.id === id);
                          return (
                            <Badge key={id} variant="secondary" className="gap-1 text-xs">
                              {m?.label ?? id}
                              <button
                                type="button"
                                onClick={() => setManualModels((p) => p.filter((i) => i !== id))}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  onClick={handleAddManualPrompt}
                  disabled={
                    isAddingManual ||
                    !manualText.trim() ||
                    (manualScrapers.length === 0 && manualModels.length === 0)
                  }
                  className="w-full"
                >
                  {isAddingManual ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add Prompt
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* AI Generate */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4" />
                AI Generate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Select topics and generate 5 optimized search prompts per topic using AI.
                </p>
                {topics.length > 0 ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                      Topics
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {topics.map((topic) => {
                        const selected = generateTopics?.includes(topic.name) ?? false;
                        return (
                          <Badge
                            key={topic.id}
                            variant={selected ? 'default' : 'outline'}
                            className="cursor-pointer select-none"
                            onClick={() =>
                              setGenerateTopics((prev) =>
                                selected
                                  ? (prev ?? []).filter((t) => t !== topic.name)
                                  : [...(prev ?? []), topic.name],
                              )
                            }
                          >
                            {topic.name}
                          </Badge>
                        );
                      })}
                    </div>
                    {generateTopics && generateTopics.length > 0 && (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {generateTopics.length} topic{generateTopics.length !== 1 ? 's' : ''}{' '}
                        selected — {generateTopics.length * 5} prompts will be generated
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    No topics defined yet. Add topics in brand settings first.
                  </p>
                )}
                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || !generateTopics || generateTopics.length === 0}
                  className="w-full"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Prompts
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Suggestions Review (shown only when generated) */}
      {canManage && suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review AI Suggestions</CardTitle>
            <CardDescription>
              Toggle off prompts you don&apos;t want, edit text if needed, then save.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {suggestions.map((s, i) => (
                <PromptSuggestionCard
                  key={i}
                  text={s.text}
                  category={s.category}
                  isActive={s.isActive}
                  onToggle={() =>
                    setSuggestions((prev) =>
                      prev.map((p, idx) => (idx === i ? { ...p, isActive: !p.isActive } : p)),
                    )
                  }
                  onTextChange={(text) =>
                    setSuggestions((prev) => prev.map((p, idx) => (idx === i ? { ...p, text } : p)))
                  }
                  mode="review"
                />
              ))}
            </div>

            <div className="flex items-center gap-3 pt-4">
              <Button onClick={handleSaveSuggestions} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save Selected ({suggestions.filter((s) => s.isActive).length})
              </Button>
              <Button variant="outline" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Regenerate
              </Button>
              <Button variant="ghost" onClick={() => setSuggestions([])}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Prompts — flat list, newest first */}
      {allPrompts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">All Prompts ({allPrompts.length})</h2>
            <Button
              size="sm"
              variant={unanalyzedPrompts.length > 0 ? 'default' : 'outline'}
              onClick={openAnalyzeDialog}
            >
              <Search className="mr-2 h-3.5 w-3.5" />
              Analyze Prompts
              {unanalyzedPrompts.length > 0 && (
                <Badge variant="secondary" className="ml-2 text-[10px]">
                  {unanalyzedPrompts.length} new
                </Badge>
              )}
            </Button>
          </div>
          <div className="space-y-2">
            {allPrompts.map((prompt) => (
              <PromptSuggestionCard
                key={prompt.id}
                text={prompt.text}
                category={prompt.category ?? ''}
                isActive={prompt.isActive}
                regions={prompt.regions}
                models={prompt.models}
                platforms={prompt.platforms}
                topics={topics}
                allowedScraperIds={allowedScraperIds}
                allowedModelIds={allowedModelIds}
                onToggle={() => handleTogglePrompt(prompt)}
                onTextChange={(text) => handleEditPrompt(prompt.id, text)}
                onCategoryChange={(category) => handleCategoryChange(prompt.id, category)}
                onModelsChange={(models) => handleModelsChange(prompt.id, models)}
                onPlatformsChange={(platforms) => handlePlatformsChange(prompt.id, platforms)}
                onDelete={() => handleDeletePrompt(prompt.id)}
                mode="manage"
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {allPrompts.length === 0 && suggestions.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <h3 className="mt-3 text-sm font-medium">No prompts yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Add prompts manually or generate them with AI above.
          </p>
        </div>
      )}

      {/* Analyze Prompts Dialog */}
      <Dialog open={analyzeDialogOpen} onOpenChange={setAnalyzeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Analyze Prompts</DialogTitle>
            <DialogDescription>
              {unanalyzedPrompts.length > 0
                ? 'Select which prompts to analyze with AI platforms.'
                : 'All prompts have already been analyzed.'}
            </DialogDescription>
          </DialogHeader>

          {isLoadingUnanalyzed ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : unanalyzedPrompts.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {selectedAnalyzeIds.size} of {unanalyzedPrompts.length} selected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (selectedAnalyzeIds.size === unanalyzedPrompts.length) {
                      setSelectedAnalyzeIds(new Set());
                    } else {
                      setSelectedAnalyzeIds(new Set(unanalyzedPrompts.map((p) => p.id)));
                    }
                  }}
                >
                  {selectedAnalyzeIds.size === unanalyzedPrompts.length
                    ? 'Deselect All'
                    : 'Select All'}
                </Button>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
                {unanalyzedPrompts.map((prompt) => {
                  const checked = selectedAnalyzeIds.has(prompt.id);
                  return (
                    <label
                      key={prompt.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md p-2 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => {
                          setSelectedAnalyzeIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.delete(prompt.id);
                            else next.add(prompt.id);
                            return next;
                          });
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{prompt.text}</p>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          {prompt.category}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="py-6 text-center">
              <Play className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm text-muted-foreground">
                All prompts have been analyzed. Add new prompts to analyze them.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAnalyzeDialogOpen(false)}>
              Cancel
            </Button>
            {unanalyzedPrompts.length > 0 && (
              <Button
                onClick={handleAnalyzeSelected}
                disabled={isAnalyzing || selectedAnalyzeIds.size === 0}
              >
                {isAnalyzing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                Analyze ({selectedAnalyzeIds.size})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
