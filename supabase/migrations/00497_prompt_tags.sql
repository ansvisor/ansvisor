-- Multiple custom tags on a tracked prompt, cutting across Topics (#2151).
-- A prompt keeps its one topic_id; tags are many-per-prompt, cross-cutting
-- labels (campaign, funnel stage, product line, priority) so grouping does
-- not have to duplicate prompts or mint near-duplicate topics. A text[]
-- column matches the house style of prompts.platforms, models and regions,
-- and a GIN index serves the "has any of / has all of" filters on the
-- prompts list. The Chat agents' Signal trigger filter already declares
-- entity_filter.prompt_tags (web/src/lib/chat/agent-rules.ts); its matcher
-- stubs the filter false today because prompts kept no tags yet.

alter table public.prompts
  add column if not exists tags text[] not null default '{}'::text[];

comment on column public.prompts.tags is
  'Cross-cutting labels many-per-prompt, orthogonal to topic_id (campaign, funnel stage, product line, priority).';

create index if not exists idx_prompts_tags on public.prompts using gin (tags);
