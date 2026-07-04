-- (OPTUMUS_ENCRYPTION_KEY) is the only thing that can decrypt it —

alter table public.organizations
  add column if not exists anthropic_api_key_encrypted text,
  add column if not exists anthropic_api_key_last4 text,
  add column if not exists anthropic_api_key_set_at timestamptz,
  add column if not exists anthropic_api_key_set_by uuid references public.profiles(id) on delete set null;

comment on column public.organizations.anthropic_api_key_encrypted is
  'AES-256-GCM ciphertext (JSON envelope) of the org-level Anthropic API key. Null = no key configured.';
comment on column public.organizations.anthropic_api_key_last4 is
  'Last 4 chars of the plaintext key. Display-only; safe to expose to org members.';
comment on column public.organizations.anthropic_api_key_set_at is
  'When the current key was last saved.';
comment on column public.organizations.anthropic_api_key_set_by is
  'Profile of the org member who saved the current key. Set null on profile delete to preserve audit trail.';
