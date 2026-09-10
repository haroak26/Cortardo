import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users, Search, UserPlus, SlidersHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWorkspace } from '@/contexts/workspace-context';
import { Button } from '@/components/button';
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
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-violet-50 text-violet-700',
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

function MemberRow({ member }: { member: Member }) {
  const name = member.displayName || member.email.split('@')[0];
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

  const { data: rawMembers, isLoading } = useQuery({
    queryKey: [`/api/workspaces/${activeWorkspaceId}/members`],
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
          type="button"
          design="primary"
          size="md"
          onClick={() => setOpen(!open)}
        >
          Filter
          <SlidersHorizontal />
        </Button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
              {roleFilterOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setRoleFilter(opt.value); setOpen(false); }}
                  className={`flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                    opt.value === roleFilter ? 'bg-surface-hover text-foreground' : 'text-fg-soft hover:bg-surface-hover'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-4 sm:py-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Team Members</h1>
          {canManage && (
            <Button size="sm" onClick={() => setShowInvite(true)}>
              <UserPlus size={15} /> Invite member
            </Button>
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
                    <Button size="sm" className="mt-4" onClick={() => setShowInvite(true)}>
                      <UserPlus size={12} /> Invite member
                    </Button>
                  )}
                </div>
              ) : (
                filteredMembers.map(member => (
                  <MemberRow
                    key={member.id}
                    member={member}
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