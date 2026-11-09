'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { listRoleMembers, type RoleMember } from '@/lib/actions/chat-access';
import { MemberBrandsCell } from '@/components/chat-access/roles-access-section';
import {
  listMembers,
  listInvitations,
  listShareableBrands,
  inviteMember,
  revokeInvitation,
  resendInvitation,
  setMemberBrands,
  updateMemberRole,
  removeMember,
  getTeamInfo,
  type BrandAccessChoice,
  type ShareableBrand,
  type TeamMember,
  type TeamInvitation,
  type TeamInfo,
  type TeamRole,
} from '@/lib/actions/team';
import {
  BrandAccessField,
  brandAccessLabel,
  isBrandChoiceComplete,
} from '@/components/settings/brand-access-field';
import {
  ArrowUpRight,
  Building2,
  Copy,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useUpgradeGate } from '@/components/providers/upgrade-gate';
import { formatDate } from '@/lib/format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROLE_VALUES: TeamRole[] = ['admin', 'manager', 'analyst', 'agency_partner'];

type SettingsT = ReturnType<typeof useTranslations<'settings'>>;

function roleOptions(t: SettingsT): { value: TeamRole; label: string }[] {
  return ROLE_VALUES.map((value) => ({ value, label: t(`team_role_${value}`) }));
}

function roleLabel(t: SettingsT, role: TeamRole): string {
  return ROLE_VALUES.includes(role) ? t(`team_role_${role}`) : role;
}

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function TeamSection({
  withChatAccess = false,
}: {
  /**
   * In Team, roles & access (owner, 2026-11-09): the members in one table
   * with how each role reaches Chat and when they last signed in (the roles
   * read), where the roles below no longer list them again.
   */
  withChatAccess?: boolean;
} = {}) {
  const t = useTranslations('settings');
  const tAccess = useTranslations('chatAccess');
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState<TeamRole | null>(null);
  // The brands an admin may share (BRAND-ACCESS §3.2); none for anyone else.
  const [brands, setBrands] = useState<ShareableBrand[]>([]);

  const loadData = useCallback(async () => {
    try {
      const [m, i, inf] = await Promise.all([listMembers(), listInvitations(), getTeamInfo()]);
      setMembers(m);
      setInvitations(i);
      setInfo(inf);
      const me = m.find((mem) => mem.isCurrentUser);
      setCurrentRole(me?.role ?? null);
      if (me?.role === 'admin' && inf.multiBrand) setBrands(await listShareableBrands());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // The roles read's rows, by member: last sign-in and brands' names. Read
  // again with the team; one that fails leaves those cells as "–".
  const [chatRows, setChatRows] = useState<Map<string, RoleMember> | null>(null);
  useEffect(() => {
    if (!withChatAccess || isLoading) return;
    let live = true;
    listRoleMembers()
      .then((read) => {
        if (live && read.ok) setChatRows(new Map(read.members.map((m) => [m.userId, m])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [withChatAccess, isLoading, members]);

  const isAdmin = currentRole === 'admin';
  // Brands to choose only on a plan with more than one (BRAND-ACCESS §9 Q1).
  const multiBrand = Boolean(info?.multiBrand);
  const seatsLabel = info
    ? info.maxTeamMembers === -1
      ? t('team_seatsUsedUnlimited', { count: info.seatsUsed })
      : t('team_seatsUsed', { used: info.seatsUsed, max: info.maxTeamMembers })
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{t('team')}</CardTitle>
            <CardDescription>
              {t('team_description')}
              {seatsLabel && <span className="ml-1 text-foreground">· {seatsLabel}</span>}
            </CardDescription>
          </div>
          {isAdmin && info && (
            <InviteDialog
              canInvite={info.canInvite}
              brands={multiBrand ? brands : []}
              onInvited={() => {
                loadData();
              }}
            />
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <>
              {withChatAccess ? (
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{tAccess('roles.columns.member')}</TableHead>
                        <TableHead>{tAccess('roles.columns.role')}</TableHead>
                        <TableHead>{tAccess('roles.columns.brands')}</TableHead>
                        <TableHead>{tAccess('roles.columns.throughChat')}</TableHead>
                        <TableHead>{tAccess('roles.columns.lastActive')}</TableHead>
                        <TableHead className="w-10">
                          <span className="sr-only">{t('removeMember')}</span>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {members.map((member) => (
                        <MemberTableRow
                          key={member.userId}
                          member={member}
                          isAdmin={isAdmin}
                          showBrands={multiBrand && (isAdmin || member.isCurrentUser)}
                          brands={brands}
                          chat={chatRows?.get(member.userId) ?? null}
                          onChanged={loadData}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="space-y-1">
                  {members.map((member) => (
                    <MemberRow
                      key={member.userId}
                      member={member}
                      isAdmin={isAdmin}
                      showBrands={multiBrand && (isAdmin || member.isCurrentUser)}
                      brands={brands}
                      onChanged={loadData}
                    />
                  ))}
                </div>
              )}
              {isAdmin && info && !info.canInvite && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-200">
                      {t('team_seatLimitTitle')}
                    </p>
                    <p className="text-amber-800/80 dark:text-amber-300/80">
                      {t('team_seatLimitDescription', {
                        plan: info.planName,
                        count: info.maxTeamMembers,
                      })}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push('/dashboard/settings?tab=billing')}
                  >
                    {t('team_upgrade')}
                    <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('team_pendingInvitations')}</CardTitle>
            <CardDescription>{t('team_pendingInvitationsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  isAdmin={isAdmin}
                  showBrands={multiBrand && isAdmin}
                  onChanged={loadData}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** A member's role change and removal, for either layout. */
function useMemberActions(member: TeamMember, onChanged: () => void) {
  const t = useTranslations('settings');
  const [pendingRole, setPendingRole] = useState<TeamRole | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  async function changeRole(role: TeamRole) {
    if (role === member.role) return;
    setPendingRole(role);
    try {
      await updateMemberRole(member.userId, role);
      toast.success(t('team_roleUpdated'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_roleUpdateFailed'));
    } finally {
      setPendingRole(null);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await removeMember(member.userId);
      toast.success(t('team_memberRemoved'));
      setRemoveDialogOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_memberRemoveFailed'));
    } finally {
      setRemoving(false);
    }
  }

  return { pendingRole, changeRole, removing, remove, removeDialogOpen, setRemoveDialogOpen };
}

type MemberActions = ReturnType<typeof useMemberActions>;

/** The member's name and e-mail, with their avatar. */
function MemberName({ member }: { member: TeamMember }) {
  const t = useTranslations('settings');
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar>
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
        <AvatarFallback>{initials(member.fullName, member.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{member.fullName || member.email}</span>
          {member.isCurrentUser && (
            <Badge variant="secondary" className="text-xs">
              {t('team_you')}
            </Badge>
          )}
        </div>
        {member.fullName && (
          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        )}
      </div>
    </div>
  );
}

/** An Admin's role picker for someone else; everyone else sees the role. */
function MemberRole({
  member,
  canEdit,
  actions,
}: {
  member: TeamMember;
  canEdit: boolean;
  actions: MemberActions;
}) {
  const t = useTranslations('settings');
  // A read-only workspace (plan not active): a role opens the upgrade dialog
  // instead. Remove stays open: it ends a member's access.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');
  if (!canEdit) return <Badge variant="outline">{roleLabel(t, member.role)}</Badge>;
  return (
    <Select
      items={roleOptions(t)}
      value={member.role}
      onValueChange={guard((v: string | null) => void actions.changeRole(v as TeamRole), {
        action: tActions('changeRoles'),
      })}
      disabled={actions.pendingRole !== null}
    >
      <SelectTrigger size="sm" className="w-36" aria-label={t('team_roleLabel')}>
        {actions.pendingRole ? <Loader2 className="h-3 w-3 animate-spin" /> : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {roleOptions(t).map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The member's brands: an Admin edits someone else's; otherwise what they are. */
function MemberBrandsControl({
  member,
  canEdit,
  brands,
  onChanged,
}: {
  member: TeamMember;
  canEdit: boolean;
  brands: ShareableBrand[];
  onChanged: () => void;
}) {
  const tBrands = useTranslations('settings.teamBrands');
  return canEdit && member.role !== 'admin' ? (
    <EditBrandsDialog member={member} brands={brands} onChanged={onChanged} />
  ) : (
    <span className="text-xs text-muted-foreground">
      {brandAccessLabel(tBrands, member.brandAccess)}
    </span>
  );
}

/** Remove, behind a confirmation. */
function RemoveMember({ member, actions }: { member: TeamMember; actions: MemberActions }) {
  const t = useTranslations('settings');
  return (
    <Dialog open={actions.removeDialogOpen} onOpenChange={actions.setRemoveDialogOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={t('removeMember')}>
            <Trash2 className="h-4 w-4" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team_removeDialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('team_removeDialogDescription', { name: member.fullName || member.email })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('team_cancel')}</DialogClose>
          <Button variant="destructive" onClick={actions.remove} disabled={actions.removing}>
            {actions.removing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('team_removing')}
              </>
            ) : (
              t('team_removeMemberConfirm')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberRow({
  member,
  isAdmin,
  showBrands,
  brands,
  onChanged,
}: {
  member: TeamMember;
  isAdmin: boolean;
  /** The member's brands: an admin sees everyone's, anyone else their own. */
  showBrands: boolean;
  brands: ShareableBrand[];
  onChanged: () => void;
}) {
  const actions = useMemberActions(member, onChanged);
  const canEdit = isAdmin && !member.isCurrentUser;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <MemberName member={member} />
      </div>
      {showBrands && (
        <span className="hidden shrink-0 sm:inline">
          <MemberBrandsControl
            member={member}
            canEdit={canEdit}
            brands={brands}
            onChanged={onChanged}
          />
        </span>
      )}
      <MemberRole member={member} canEdit={canEdit} actions={actions} />
      {canEdit && <RemoveMember member={member} actions={actions} />}
    </div>
  );
}

/**
 * A member's row in Team, roles & access's one table (owner, 2026-11-09):
 * Team's controls (role, brands, remove) with what the roles read adds,
 * how the role reaches Chat and when they last signed in.
 */
function MemberTableRow({
  member,
  isAdmin,
  showBrands,
  brands,
  chat,
  onChanged,
}: {
  member: TeamMember;
  isAdmin: boolean;
  showBrands: boolean;
  brands: ShareableBrand[];
  /** The roles read's row for them; null while it loads or when it couldn't be read. */
  chat: RoleMember | null;
  onChanged: () => void;
}) {
  const tAccess = useTranslations('chatAccess');
  const format = useFormatter();
  const actions = useMemberActions(member, onChanged);
  const canEdit = isAdmin && !member.isCurrentUser;
  return (
    <TableRow>
      <TableCell className="max-w-64">
        <MemberName member={member} />
      </TableCell>
      <TableCell>
        <MemberRole member={member} canEdit={canEdit} actions={actions} />
      </TableCell>
      <TableCell>
        {showBrands ? (
          <MemberBrandsControl
            member={member}
            canEdit={canEdit}
            brands={brands}
            onChanged={onChanged}
          />
        ) : chat ? (
          <span className="text-xs text-muted-foreground">
            <MemberBrandsCell brands={chat.brands} />
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </TableCell>
      <TableCell className="text-xs whitespace-normal text-muted-foreground">
        {tAccess(`roles.throughChat.${member.role}`)}
      </TableCell>
      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
        {!chat
          ? '–'
          : chat.lastActiveAt
            ? format.relativeTime(new Date(chat.lastActiveAt))
            : tAccess('roles.neverSignedIn')}
      </TableCell>
      <TableCell className="w-10 text-right">
        {canEdit && <RemoveMember member={member} actions={actions} />}
      </TableCell>
    </TableRow>
  );
}

function InvitationRow({
  invitation,
  isAdmin,
  showBrands,
  onChanged,
}: {
  invitation: TeamInvitation;
  isAdmin: boolean;
  /** The brands it shares: admins only. */
  showBrands: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('settings');
  const tBrands = useTranslations('settings.teamBrands');
  const [busy, setBusy] = useState<'revoke' | 'resend' | null>(null);
  // A read-only workspace (plan not active): Resend opens the upgrade dialog
  // instead. Revoke stays open: it ends an invitation's access.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  async function handleRevoke() {
    setBusy('revoke');
    try {
      await revokeInvitation(invitation.id);
      toast.success(t('team_invitationRevoked'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_invitationRevokeFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleResend() {
    setBusy('resend');
    try {
      const { inviteLink } = await resendInvitation(invitation.id);
      await navigator.clipboard.writeText(inviteLink).catch(() => {});
      toast.success(t('team_invitationResent'));
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_invitationResendFailed'));
    } finally {
      setBusy(null);
    }
  }

  const expired = new Date(invitation.expiresAt).getTime() < Date.now();

  return (
    <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 hover:bg-muted/50">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <Mail className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{invitation.email}</p>
        <p className="text-xs text-muted-foreground">
          {expired
            ? t('team_expired')
            : t('team_expires', { date: formatDate(invitation.expiresAt) })}
        </p>
      </div>
      {showBrands && (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
          {brandAccessLabel(tBrands, invitation.brandAccess)}
        </span>
      )}
      <Badge variant="outline">{roleLabel(t, invitation.role)}</Badge>
      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy !== null}
                aria-label={t('invitationActions')}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={guard(handleResend, { action: tActions('resendInvitations') })}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('team_resendInvite')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRevoke}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('team_revoke')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

const ALL_BRANDS: BrandAccessChoice = { scope: 'all', brandIds: [] };

function InviteDialog({
  canInvite,
  brands,
  onInvited,
}: {
  canInvite: boolean;
  /** The brands to choose from; none hides the choice (one brand, or not an admin). */
  brands: ShareableBrand[];
  onInvited: () => void;
}) {
  const t = useTranslations('settings');
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('analyst');
  const [brandAccess, setBrandAccess] = useState<BrandAccessChoice>(ALL_BRANDS);
  const brandsComplete = isBrandChoiceComplete(brandAccess, role === 'admin');
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(true);
  // A read-only workspace (plan not active): the upgrade dialog instead of this one.
  const { isLocked, openUpgrade } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  function reset() {
    setEmail('');
    setRole('analyst');
    setBrandAccess(ALL_BRANDS);
    setInviteLink(null);
    setEmailSent(true);
  }

  async function handleSubmit() {
    if (!email.trim()) {
      toast.error(t('team_emailRequired'));
      return;
    }
    setSubmitting(true);
    try {
      const result = await inviteMember(
        email.trim(),
        role,
        role === 'admin' ? ALL_BRANDS : brandAccess,
      );
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      setInviteLink(result.inviteLink);
      setEmailSent(result.emailSent);
      toast.success(result.emailSent ? t('team_invitationSent') : t('team_inviteCreated'));
      onInvited();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('team_invitationSendFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink).catch(() => {});
    toast.success(t('team_linkCopied'));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o, details) => {
        if (o && isLocked) {
          details.cancel();
          openUpgrade(tActions('inviteMembers'));
          return;
        }
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" disabled={!canInvite}>
            <UserPlus className="mr-2 h-4 w-4" />
            {t('team_inviteMember')}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('team_inviteDialogTitle')}</DialogTitle>
          <DialogDescription>{t('team_inviteDialogDescription')}</DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {emailSent ? t('team_inviteLinkEmailSent') : t('team_inviteLinkNoEmail')}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteLink} className="ph-no-capture flex-1 text-xs" />
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('team_email')}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder={t('team_emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t('team_role')}</Label>
              <Select
                items={roleOptions(t)}
                value={role}
                onValueChange={(v) => setRole(v as TeamRole)}
                disabled={submitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions(t).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {brands.length > 0 && (
              <BrandAccessField
                brands={brands}
                value={brandAccess}
                onChange={setBrandAccess}
                adminRole={role === 'admin'}
                disabled={submitting}
              />
            )}
          </div>
        )}

        <DialogFooter>
          {inviteLink ? (
            <DialogClose render={<Button />}>{t('team_done')}</DialogClose>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>{t('team_cancel')}</DialogClose>
              <Button onClick={handleSubmit} disabled={submitting || !brandsComplete}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('team_sending')}
                  </>
                ) : (
                  t('team_sendInvitation')
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An admin's Edit brands for one person (BRAND-ACCESS §3.2): All brands, or
 * the brands they work on. Saved in one go; they see the new brands from
 * their next page.
 */
function EditBrandsDialog({
  member,
  brands,
  onChanged,
}: {
  member: TeamMember;
  brands: ShareableBrand[];
  onChanged: () => void;
}) {
  const t = useTranslations('settings.teamBrands');
  const tSettings = useTranslations('settings');
  const tActions = useTranslations('readOnly.actions');
  const { isLocked, openUpgrade } = useUpgradeGate();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<BrandAccessChoice>(member.brandAccess);
  const [saving, setSaving] = useState(false);
  const name = member.fullName || member.email;

  async function save() {
    setSaving(true);
    try {
      const result = await setMemberBrands(member.userId, value);
      if ('error' in result) {
        toast.error(result.error);
        return;
      }
      toast.success(t('saved', { name }));
      setOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o, details) => {
        if (o && isLocked) {
          details.cancel();
          openUpgrade(tActions('changeRoles'));
          return;
        }
        if (o) setValue(member.brandAccess);
        setOpen(o);
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 gap-1.5 px-2 text-xs font-normal text-muted-foreground"
            aria-label={t('editFor', { name })}
          >
            <Building2 className="h-3.5 w-3.5" />
            {brandAccessLabel(t, member.brandAccess)}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editTitle')}</DialogTitle>
          <DialogDescription>{t('editDescription', { name })}</DialogDescription>
        </DialogHeader>
        <BrandAccessField brands={brands} value={value} onChange={setValue} disabled={saving} />
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {tSettings('team_cancel')}
          </DialogClose>
          <Button onClick={save} disabled={saving || !isBrandChoiceComplete(value, false)}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
