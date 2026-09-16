import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import { Button, IconButton, brandIconButtonClass } from '@/components/button';
import {
  OpenDropdown,
  OpenDropdownBackdrop,
  OpenDropdownItem,
  OpenDropdownMenu,
} from '@/components/open-dropdown';
import { ListSkeleton } from '@/components/ds';
import { InviteModal } from '@/components/team/InviteModal';

interface Member {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  available: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-violet-50 text-violet-700',
  admin: 'bg-indigo-50 text-indigo-700',
  editor: 'bg-blue-50 text-blue-700',
  viewer: 'bg-gray-100 text-gray-600',
};

const EDITABLE_ROLES = ['admin', 'editor', 'viewer'];

function RoleBadge({ role }: { role: string }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${ROLE_COLORS[role] ?? ROLE_COLORS.viewer}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

function StatusBadge({ member }: { member: Member }) {
  if (member.status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Pending
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${member.available ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${member.available ? 'bg-emerald-500' : 'bg-gray-400'}`} />
      {member.available ? 'Online' : 'Away'}
    </span>
  );
}

function MemberAvatar({ member, name }: { member: Member; name: string }) {
  return (
    <div className="relative shrink-0">
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt={name} className="w-9 h-9 rounded-full object-cover" />
      ) : (
        <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center">
          <span className="text-[15px] font-bold text-white">{name.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background ${member.available ? 'bg-green-500' : 'bg-gray-300'}`} />
    </div>
  );
}

function MemberRow({
  member,
  editing,
  onChangeRole,
  onRemove,
}: {
  member: Member;
  editing: boolean;
  onChangeRole: (member: Member, role: string) => void;
  onRemove: (member: Member) => void;
}) {
  const name = member.displayName || member.email.split('@')[0];
  const editable = editing && member.role !== 'owner';
  return (
    <div className="flex items-center gap-3 py-3">
      <MemberAvatar member={member} name={name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[13.5px] font-medium text-foreground truncate">{name}</span>
          <StatusBadge member={member} />
          <RoleBadge role={member.role} />
        </div>
        <p className="text-[12px] text-fg-muted truncate mt-0.5">{member.email}</p>
      </div>
      {editable && (
        <div className="flex shrink-0 items-center gap-1.5">
          <select
            value={member.role}
            onChange={(e) => onChangeRole(member, e.target.value)}
            aria-label={`Role for ${name}`}
            className="h-[30px] cursor-pointer rounded-[8px] border-none bg-surface-hover px-2 text-[12px] font-medium text-foreground outline-none"
          >
            {EDITABLE_ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
          <IconButton
            icon={Trash2}
            size="xs"
            design="ghost"
            title={`Remove ${name}`}
            aria-label={`Remove ${name}`}
            onClick={() => onRemove(member)}
            className="hover:bg-red-50 hover:text-destructive"
          />
        </div>
      )}
    </div>
  );
}

export function TeamPageContent() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [editMode, setEditMode] = useState(false);

  const membersQueryKey = [`/api/workspaces/${activeWorkspaceId}/members`];

  const { data: rawMembers, isLoading } = useQuery({
    queryKey: membersQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/members`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!activeWorkspaceId,
  });

  const { data: spacesData } = useQuery({
    queryKey: ['/api/spaces'],
    queryFn: async () => {
      const res = await fetch('/api/spaces', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const spaces = spacesData?.spaces ?? [];
  const members: Member[] = rawMembers ?? [];

  const filteredMembers = useMemo(() => {
    let items = members;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(m =>
        m.email.toLowerCase().includes(q) ||
        (m.displayName?.toLowerCase().includes(q))
      );
    }
    if (roleFilter !== 'all') items = items.filter(m => m.role === roleFilter);
    return items;
  }, [members, searchQuery, roleFilter]);

  const userRole = activeWorkspace?.role ?? 'viewer';
  const canManage = ['owner', 'editor'].includes(userRole);

  const updateMember = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Failed to update member' }));
        throw new Error(data.message ?? 'Failed to update member');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey });
      toast({ title: 'Member updated', variant: 'success' });
    },
    onError: (err: Error) =>
      toast({ title: 'Could not update member', description: err.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(`/api/workspaces/${activeWorkspaceId}/members/${memberId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: 'Failed to remove member' }));
        throw new Error(data.message ?? 'Failed to remove member');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: membersQueryKey });
      toast({ title: 'Member removed', variant: 'success' });
    },
    onError: (err: Error) =>
      toast({ title: 'Could not remove member', description: err.message, variant: 'destructive' }),
  });

  const handleRemoveMember = (member: Member) => {
    const name = member.displayName || member.email.split('@')[0];
    if (!window.confirm(`Remove ${name} from this workspace?`)) return;
    removeMember.mutate(member.id);
  };

  const roleFilterOptions = [
    { value: 'all', label: 'All roles' },
    { value: 'admin', label: 'Admins' },
    { value: 'owner', label: 'Owners' },
    { value: 'editor', label: 'Editors' },
    { value: 'viewer', label: 'Viewers' },
  ];

  function RoleFilterDropdown() {
    const [open, setOpen] = useState(false);
    return (
      <div className="relative shrink-0">
        <OpenDropdown
          open={open}
          onClick={() => setOpen((value) => !value)}
          chevron={false}
          className={brandIconButtonClass}
          aria-label="Filter members by role"
        >
          <SlidersHorizontal size={16} strokeWidth={2} />
        </OpenDropdown>
        {roleFilter !== 'all' && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-[8px] top-[8px] h-[5px] w-[5px] rounded-full bg-brand-foreground"
          />
        )}
        {open && (
          <>
            <OpenDropdownBackdrop onClick={() => setOpen(false)} />
            <OpenDropdownMenu align="right" className="min-w-[150px]">
              {roleFilterOptions.map((option) => (
                <OpenDropdownItem
                  key={option.value}
                  selected={option.value === roleFilter}
                  onClick={() => {
                    setRoleFilter(option.value);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </OpenDropdownItem>
              ))}
            </OpenDropdownMenu>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 pt-10 pb-4 sm:pt-14 sm:pb-6 max-w-5xl mx-auto w-full">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="font-sans text-[15px] font-medium leading-tight text-foreground truncate">
              Team Members
            </h1>
            <p className="mt-0.5 text-[12px] font-[450] leading-snug text-fg-warm">
              Manage who can access this workspace and what they can do.
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              <Button design="pill" onClick={() => setShowInvite(true)}>
                Invite Team
              </Button>
              <Button design="pill-secondary" onClick={() => setEditMode((value) => !value)}>
                {editMode ? 'Done' : 'Edit'}
              </Button>
            </div>
          )}
        </div>

        {!activeWorkspaceId ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-[13px] text-fg-muted">Select a workspace to manage your team</p>
          </div>
        ) : isLoading ? (
          <ListSkeleton rows={6} className="[&>*]:px-0" />
        ) : (
          <>
            <div className="flex items-center gap-2 mb-6">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
                />
              </div>
              <RoleFilterDropdown />
            </div>

            <div className="divide-y divide-border/60">
              {filteredMembers.length === 0 ? (
                <div className="py-16 text-center">
                  <Users size={24} className="text-fg-faint mx-auto mb-3" />
                  <p className="text-[14px] font-medium text-foreground">
                    {searchQuery || roleFilter !== 'all' ? 'No members match your filters' : 'No team members yet'}
                  </p>
                  <p className="text-[12px] text-fg-muted mt-1">
                    {searchQuery || roleFilter !== 'all' ? 'Try a different search or role filter.' : 'Invite your first teammate to start routing work together.'}
                  </p>
                  {canManage && !searchQuery && roleFilter === 'all' && (
                    <Button design="pill" className="mt-4" onClick={() => setShowInvite(true)}>
                      Invite Team
                    </Button>
                  )}
                </div>
              ) : (
                filteredMembers.map(member => (
                  <MemberRow
                    key={member.id}
                    member={member}
                    editing={editMode}
                    onChangeRole={(target, role) => updateMember.mutate({ memberId: target.id, role })}
                    onRemove={handleRemoveMember}
                  />
                ))
              )}
            </div>
          </>
        )}

        {showInvite && (
          <InviteModal
            workspaceId={activeWorkspaceId!}
            spaces={spaces}
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              qc.invalidateQueries({ queryKey: [`/api/workspaces/${activeWorkspaceId}/members`] });
              setShowInvite(false);
            }}
          />
        )}
      </div>
    </div>
  );
}

export default function TeamPage() {
  return <TeamPageContent />;
}