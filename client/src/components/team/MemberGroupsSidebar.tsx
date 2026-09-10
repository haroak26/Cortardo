import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader, Trash2 } from 'lucide-react';
import { Button } from '@/components/button';
import { TextInput } from '@/components/text-input';
import { useToast } from '@/hooks/use-toast';

interface Group {
  id: string;
  name: string;
  description?: string | null;
  color: string;
  memberCount: number;
}

interface MemberGroupsSidebarProps {
  workspaceId: string;
  selectedGroup: string | null;
  onSelectGroup: (groupId: string | null) => void;
}

export function MemberGroupsSidebar({ workspaceId, selectedGroup, onSelectGroup }: MemberGroupsSidebarProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupColor, setGroupColor] = useState('#8b5cf6');

  const { data: groupsData, isLoading } = useQuery<{ groups: Group[] }>({
    queryKey: [`/api/workspaces/${workspaceId}/groups`],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/groups`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    enabled: !!workspaceId,
  });

  const groups = groupsData?.groups ?? [];

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/groups`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: groupName, color: groupColor }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/groups`] });
      setGroupName('');
      setShowCreate(false);
      toast({ title: 'Group created', variant: 'success' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (groupId: string) => {
      await fetch(`/api/workspaces/${workspaceId}/groups/${groupId}`, { method: 'DELETE', credentials: 'include' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/groups`] });
      if (selectedGroup) onSelectGroup(null);
      toast({ title: 'Group deleted', variant: 'success' });
    },
  });

  const COLORS = ['#8b5cf6', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#6366f1', '#14b8a6'];

  return (
    <div className="w-44 shrink-0 border-r border-border/60 overflow-y-auto p-2 space-y-0.5">
      <button
        onClick={() => onSelectGroup(null)}
        className={`w-full text-left text-[12px] px-2.5 py-1.5 rounded-[8px] transition-colors ${
          !selectedGroup ? 'bg-surface-active font-medium text-foreground' : 'text-fg-muted hover:text-foreground hover:bg-surface-hover'
        }`}
      >
        All members
        <span className="text-[10px] text-fg-faint ml-1">({groups.reduce((sum, g) => sum + g.memberCount, 0)})</span>
      </button>

      {groups.map(group => (
        <div key={group.id} className="group flex items-center">
          <button
            onClick={() => onSelectGroup(group.id)}
            className={`flex-1 text-left text-[12px] px-2.5 py-1.5 rounded-[8px] transition-colors truncate ${
              selectedGroup === group.id ? 'bg-surface-active font-medium text-foreground' : 'text-fg-muted hover:text-foreground hover:bg-surface-hover'
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: group.color }} />
            {group.name}
            <span className="text-[10px] text-fg-faint ml-1">({group.memberCount})</span>
          </button>
          <button
            onClick={() => { if (confirm(`Delete "${group.name}" group?`)) deleteMutation.mutate(group.id); }}
            className="opacity-0 group-hover:opacity-100 h-6 w-6 flex items-center justify-center rounded text-fg-faint hover:text-red-500 hover:bg-red-50 transition-all shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {showCreate ? (
        <div className="pt-2 space-y-2">
          <TextInput value={groupName} onChange={e => setGroupName(e.target.value)}
            placeholder="Group name" />
          <div className="flex gap-1 flex-wrap">
            {COLORS.map(c => (
              <button key={c} onClick={() => setGroupColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-all ${groupColor === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-1">
            <Button size="xs" onClick={() => createMutation.mutate()} disabled={!groupName.trim() || createMutation.isPending} isLoading={createMutation.isPending}>
              Create
            </Button>
            <button onClick={() => setShowCreate(false)} className="text-[11px] text-fg-muted hover:text-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCreate(true)}
          className="w-full text-left text-[11px] px-2.5 py-1.5 rounded-[8px] text-fg-faint hover:text-foreground hover:bg-surface-hover transition-colors mt-0.5">
          <Plus size={10} className="inline mr-1" /> New group
        </button>
      )}
    </div>
  );
}
