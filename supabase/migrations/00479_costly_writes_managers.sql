-- Deleting a Site Audit and approving or rejecting a brand fact are admins'
-- and managers' (server/src/routes/audits.js, brand-facts.js, 2026-11-03).
-- The routes check the role; these policies hold the same limit for a
-- member's own session, so an analyst can't do either straight through the
-- database. Changing an audit row is held the same way: the server writes
-- audits with the service role, and no member's session updates one.

drop policy if exists site_audits_member_update on public.site_audits;
create policy site_audits_member_update on public.site_audits
  for update
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists site_audits_member_delete on public.site_audits;
create policy site_audits_member_delete on public.site_audits
  for delete
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

drop policy if exists "brand_facts: member update" on public.brand_facts;
create policy "brand_facts: member update"
  on public.brand_facts
  for update
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and reviewed_by = auth.uid()
    and status in ('approved', 'rejected')
    and reviewed_at between now() - interval '1 minute' and now() + interval '1 minute'
  );
