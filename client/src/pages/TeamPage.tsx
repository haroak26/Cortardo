import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import { Button } from '@/components/button';
import {
  OpenDropdownBackdrop,
  OpenDropdownItem,
  OpenDropdownMenu,
} from '@/components/open-dropdown';
import { ListSkeleton } from '@/components/ds';
import { SettingsCard, SettingsRow } from '@/components/settings-ui';
import { InviteWorkspacePopup } from '@/components/InviteWorkspacePopup';
import { InfoChipHover } from '@/components/info-chip';

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
      <InfoChipHover label="Invite pending">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-50"
          aria-label="Pending"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        </span>
      </InfoChipHover>
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

function MemberRow({ member }: { member: Member }) {
  const name = member.displayName || member.email.split('@')[0];
  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-3">
          <MemberAvatar member={member} name={name} />
          <span className="min-w-0">
            <span className="block truncate">{name}</span>
            <span className="mt-0.5 block truncate text-[12px] font-[450] leading-tight text-fg-warm">
              {member.email}
            </span>
          </span>
        </span>
      }
    >
      <span className="flex items-center gap-2">
        <StatusBadge member={member} />
        <RoleBadge role={member.role} />
      </span>
    </SettingsRow>
  );
}

export function TeamPageContent() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [roleFilter, setRoleFilter] = useState<string>('all');

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

  const members: Member[] = rawMembers ?? [];

  const filteredMembers = useMemo(() => {
    let items = members;
    if (roleFilter !== 'all') items = items.filter(m => m.role === roleFilter);
    return items;
  }, [members, roleFilter]);

  const userRole = activeWorkspace?.role ?? 'viewer';
  const canManage = ['owner', 'editor'].includes(userRole);

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
        <Button
          design="pill-secondary"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Filter members by role"
        >
          Filter
          {roleFilter !== 'all' && (
            <span aria-hidden="true" className="h-[5px] w-[5px] shrink-0 rounded-full bg-brand" />
          )}
        </Button>
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
          <div className="flex items-center gap-2 shrink-0">
            {canManage && (
              <Button
                design="pill"
                icon={Plus}
                className="hover:!bg-primary active:!bg-primary"
                onClick={() => setShowInvite(true)}
              >
                Invite Team
              </Button>
            )}
            <RoleFilterDropdown />
          </div>
        </div>

        {!activeWorkspaceId ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-[13px] text-fg-muted">Select a workspace to manage your team</p>
          </div>
        ) : isLoading ? (
          <ListSkeleton rows={6} className="[&>*]:px-0" />
        ) : filteredMembers.length === 0 ? (
          <div className="py-16 text-center">
            <Users size={24} className="text-fg-faint mx-auto mb-3" />
            <p className="text-[14px] font-medium text-foreground">
              {roleFilter !== 'all' ? 'No members match your filters' : 'No team members yet'}
            </p>
            <p className="text-[12px] text-fg-muted mt-1">
              {roleFilter !== 'all' ? 'Try a different role filter.' : 'Invite your first teammate to start routing work together.'}
            </p>
            {canManage && roleFilter === 'all' && (
              <Button
                design="pill"
                className="mt-4"
                icon={Plus}
                onClick={() => setShowInvite(true)}
              >
                Invite Team
              </Button>
            )}
          </div>
        ) : (
          <SettingsCard>
            {filteredMembers.map(member => (
              <MemberRow key={member.id} member={member} />
            ))}
          </SettingsCard>
        )}

        {showInvite && (
          <InviteWorkspacePopup
            open={showInvite}
            workspaceId={activeWorkspaceId}
            onClose={() => {
              setShowInvite(false);
              qc.invalidateQueries({ queryKey: [`/api/workspaces/${activeWorkspaceId}/members`] });
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