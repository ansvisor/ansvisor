'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  listMembers,
  listInvitations,
  inviteMember,
  revokeInvitation,
  resendInvitation,
  updateMemberRole,
  removeMember,
  getTeamInfo,
  type TeamMember,
  type TeamInvitation,
  type TeamInfo,
  type TeamRole,
} from '@/lib/actions/team';
import {
  ArrowUpRight,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const ROLE_OPTIONS: { value: TeamRole; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'agency_partner', label: 'Agency Partner' },
];

function roleLabel(role: TeamRole): string {
  return ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
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

export function TeamSection() {
  const t = useTranslations('settings');
  const router = useRouter();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentRole, setCurrentRole] = useState<TeamRole | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [m, i, inf] = await Promise.all([listMembers(), listInvitations(), getTeamInfo()]);
      setMembers(m);
      setInvitations(i);
      setInfo(inf);
      const me = m.find((mem) => mem.isCurrentUser);
      setCurrentRole(me?.role ?? null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load team');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const isAdmin = currentRole === 'admin';
  const seatsLabel = info
    ? info.maxTeamMembers === -1
      ? `${info.seatsUsed} seat${info.seatsUsed === 1 ? '' : 's'} used`
      : `${info.seatsUsed} of ${info.maxTeamMembers} seats used`
    : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>{t('team')}</CardTitle>
            <CardDescription>
              Manage team members and their access.
              {seatsLabel && <span className="ml-1 text-foreground">· {seatsLabel}</span>}
            </CardDescription>
          </div>
          {isAdmin && info && (
            <InviteDialog
              canInvite={info.canInvite}
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
              <div className="space-y-1">
                {members.map((member) => (
                  <MemberRow
                    key={member.userId}
                    member={member}
                    isAdmin={isAdmin}
                    onChanged={loadData}
                  />
                ))}
              </div>
              {isAdmin && info && !info.canInvite && (
                <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-amber-900 dark:text-amber-200">
                      Seat limit reached
                    </p>
                    <p className="text-amber-800/80 dark:text-amber-300/80">
                      Your {info.planName} plan includes {info.maxTeamMembers} seat
                      {info.maxTeamMembers === 1 ? '' : 's'}. Upgrade to invite more teammates.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push('/dashboard/settings?tab=billing')}
                  >
                    Upgrade
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
            <CardTitle>Pending invitations</CardTitle>
            <CardDescription>Invitations that haven&apos;t been accepted yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {invitations.map((inv) => (
                <InvitationRow
                  key={inv.id}
                  invitation={inv}
                  isAdmin={isAdmin}
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

function MemberRow({
  member,
  isAdmin,
  onChanged,
}: {
  member: TeamMember;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [pendingRole, setPendingRole] = useState<TeamRole | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeDialogOpen, setRemoveDialogOpen] = useState(false);

  const canEdit = isAdmin && !member.isCurrentUser;

  async function handleRoleChange(role: TeamRole) {
    if (role === member.role) return;
    setPendingRole(role);
    try {
      await updateMemberRole(member.userId, role);
      toast.success('Role updated');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update role');
    } finally {
      setPendingRole(null);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await removeMember(member.userId);
      toast.success('Member removed');
      setRemoveDialogOpen(false);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to remove member');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2 hover:bg-muted/50">
      <Avatar>
        {member.avatarUrl && <AvatarImage src={member.avatarUrl} />}
        <AvatarFallback>{initials(member.fullName, member.email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{member.fullName || member.email}</span>
          {member.isCurrentUser && (
            <Badge variant="secondary" className="text-xs">
              You
            </Badge>
          )}
        </div>
        {member.fullName && (
          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
        )}
      </div>

      {canEdit ? (
        <Select
          items={ROLE_OPTIONS}
          value={member.role}
          onValueChange={(v) => handleRoleChange(v as TeamRole)}
          disabled={pendingRole !== null}
        >
          <SelectTrigger size="sm" className="w-36">
            {pendingRole ? <Loader2 className="h-3 w-3 animate-spin" /> : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Badge variant="outline">{roleLabel(member.role)}</Badge>
      )}

      {canEdit && (
        <Dialog open={removeDialogOpen} onOpenChange={setRemoveDialogOpen}>
          <DialogTrigger
            render={
              <Button variant="ghost" size="icon-sm">
                <Trash2 className="h-4 w-4" />
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Remove team member?</DialogTitle>
              <DialogDescription>
                {member.fullName || member.email} will lose access to this organization. This cannot
                be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button variant="destructive" onClick={handleRemove} disabled={removing}>
                {removing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Removing...
                  </>
                ) : (
                  'Remove member'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function InvitationRow({
  invitation,
  isAdmin,
  onChanged,
}: {
  invitation: TeamInvitation;
  isAdmin: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<'revoke' | 'resend' | null>(null);

  async function handleRevoke() {
    setBusy('revoke');
    try {
      await revokeInvitation(invitation.id);
      toast.success('Invitation revoked');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to revoke invitation');
    } finally {
      setBusy(null);
    }
  }

  async function handleResend() {
    setBusy('resend');
    try {
      const { inviteLink } = await resendInvitation(invitation.id);
      await navigator.clipboard.writeText(inviteLink).catch(() => {});
      toast.success('Invitation resent (link copied)');
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to resend invitation');
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
          {expired ? 'Expired' : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
      </div>
      <Badge variant="outline">{roleLabel(invitation.role)}</Badge>
      {isAdmin && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" disabled={busy !== null}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={handleResend}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Resend invite
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleRevoke}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Revoke
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function InviteDialog({ canInvite, onInvited }: { canInvite: boolean; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamRole>('analyst');
  const [submitting, setSubmitting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(true);

  function reset() {
    setEmail('');
    setRole('analyst');
    setInviteLink(null);
    setEmailSent(true);
  }

  async function handleSubmit() {
    if (!email.trim()) {
      toast.error('Email is required');
      return;
    }
    setSubmitting(true);
    try {
      const { inviteLink: link, emailSent: sent } = await inviteMember(email.trim(), role);
      setInviteLink(link);
      setEmailSent(sent);
      toast.success(sent ? 'Invitation sent' : 'Invite created — share the link');
      onInvited();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink).catch(() => {});
    toast.success('Link copied');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" disabled={!canInvite}>
            <UserPlus className="mr-2 h-4 w-4" />
            Invite member
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a team member</DialogTitle>
          <DialogDescription>
            They&apos;ll receive an email with a link to join your organization.
          </DialogDescription>
        </DialogHeader>

        {inviteLink ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {emailSent
                ? 'Invitation sent. You can also share this link directly:'
                : 'No email was sent — this address may already have an account. Share this link with them directly:'}
            </p>
            <div className="flex items-center gap-2">
              <Input readOnly value={inviteLink} className="flex-1 text-xs" />
              <Button variant="outline" size="sm" onClick={copyLink}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                items={ROLE_OPTIONS}
                value={role}
                onValueChange={(v) => setRole(v as TeamRole)}
                disabled={submitting}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          {inviteLink ? (
            <DialogClose render={<Button />}>Done</DialogClose>
          ) : (
            <>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Send invitation'
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
