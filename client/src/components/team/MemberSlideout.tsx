import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Loader, Check, Clock, Star, Activity, Shield, Settings2 } from 'lucide-react';
import { Button, IconButton } from '@/components/button';
import { TextInput, Textarea } from '@/components/text-input';
import { useToast } from '@/hooks/use-toast';
import { ListSkeleton } from '@/components/ds';

interface MemberSkill {
  skill: string;
  proficiency: number;
}

interface Member {
  id: string;
  email: string;
  role: string;
  status: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  phone?: string | null;
  department?: string | null;
  title?: string | null;
  skills: MemberSkill[];
  maxCapacity: number;
  timezone?: string | null;
  available: boolean;
  currentTicketCount: number;
  lastActiveAt?: string | null;
  schedule?: Record<string, { start: string; end: string } | null>;
  notificationPreferences?: Record<string, boolean>;
}

interface MemberSlideoutProps {
  workspaceId: string;
  memberId: string;
  spaces: { id: string; name: string }[];
  onClose: () => void;
}

const SKILL_SUGGESTIONS = [
  "billing", "technical-support", "api", "mobile", "frontend",
  "backend", "security", "onboarding", "general", "sales",
  "account-management", "shipping", "refunds", "partnerships",
];

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export function MemberSlideout({ workspaceId, memberId, spaces, onClose }: MemberSlideoutProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<'profile' | 'routing' | 'schedule' | 'activity' | 'permissions' | 'performance'>('profile');

  const { data: memberData, isLoading } = useQuery({
    queryKey: ['member', workspaceId, memberId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const member: Member | undefined = memberData;

  if (isLoading || !member) {
    return (
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-background border-l border-border shadow-xl flex items-center justify-center">
        <Loader size={16} className="animate-spin text-fg-muted" />
      </div>
    );
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full max-w-lg bg-background border-l border-border shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand/20 to-brand/5 flex items-center justify-center shrink-0">
            <span className="text-[12px] font-semibold text-brand">
              {(member.displayName || member.email).charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-foreground truncate">{member.displayName || member.email.split('@')[0]}</p>
            <p className="text-[11px] text-fg-muted truncate">{member.email}</p>
          </div>
        </div>
        <IconButton icon={X} size="xs" design="ghost" onClick={onClose} />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/60 overflow-x-auto shrink-0">
        {(['profile', 'routing', 'schedule', 'activity', 'permissions', 'performance'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-fg-muted hover:text-foreground'
            }`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'profile' && <ProfileTab member={member} workspaceId={workspaceId} />}
        {tab === 'routing' && <RoutingTab memberId={member.id} workspaceId={workspaceId} />}
        {tab === 'schedule' && <ScheduleTab member={member} workspaceId={workspaceId} />}
        {tab === 'activity' && <ActivityTab memberId={member.id} workspaceId={workspaceId} />}
        {tab === 'permissions' && <PermissionsTab memberId={member.id} workspaceId={workspaceId} spaces={spaces} />}
        {tab === 'performance' && <PerformanceTab memberId={member.id} workspaceId={workspaceId} />}
      </div>
    </div>
  );
}

function ProfileTab({ member, workspaceId }: { member: Member; workspaceId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    displayName: member.displayName || '',
    bio: member.bio || '',
    phone: member.phone || '',
    department: member.department || '',
    title: member.title || '',
    timezone: member.timezone || 'UTC',
    maxCapacity: member.maxCapacity,
    available: member.available,
  });

  useEffect(() => {
    setForm({
      displayName: member.displayName || '',
      bio: member.bio || '',
      phone: member.phone || '',
      department: member.department || '',
      title: member.title || '',
      timezone: member.timezone || 'UTC',
      maxCapacity: member.maxCapacity,
      available: member.available,
    });
  }, [member]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}/profile`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['member', workspaceId, member.id] });
      qc.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/members`] });
      toast({ title: 'Profile updated', variant: 'success' });
    },
    onError: () => toast({ title: 'Update failed', variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-4">
        <div className="relative">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-brand/30 to-brand/10 flex items-center justify-center">
            <span className="text-[22px] font-bold text-brand">
              {(form.displayName || member.email).charAt(0).toUpperCase()}
            </span>
          </div>
        </div>
        <div>
          <p className="text-[13px] font-semibold text-foreground">{form.displayName || member.email.split('@')[0]}</p>
          <p className="text-[11px] text-fg-muted">{member.email}</p>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 mt-1 inline-block">{member.role}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Display name</label>
          <TextInput value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}  />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Title</label>
          <TextInput value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Senior Support"  />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Department</label>
          <TextInput value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} placeholder="Support"  />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Phone</label>
          <TextInput value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+1-555-0123"  />
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-foreground mb-1">Bio</label>
        <Textarea value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
          placeholder="Brief description of this team member"
          variant="default"
          className="h-20 px-3 py-2 text-[12px]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Timezone</label>
          <select value={form.timezone} onChange={e => setForm(f => ({ ...f, timezone: e.target.value }))}
            className="w-full h-8 rounded-[10px] border border-border bg-background px-2.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-brand">
            <option value="UTC">UTC</option>
            <option value="US/Eastern">US/Eastern</option>
            <option value="US/Central">US/Central</option>
            <option value="US/Mountain">US/Mountain</option>
            <option value="US/Pacific">US/Pacific</option>
            <option value="Europe/London">Europe/London</option>
            <option value="Europe/Berlin">Europe/Berlin</option>
            <option value="Asia/Tokyo">Asia/Tokyo</option>
            <option value="Asia/Shanghai">Asia/Shanghai</option>
            <option value="Australia/Sydney">Australia/Sydney</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Max capacity</label>
          <TextInput type="number" value={form.maxCapacity} onChange={e => setForm(f => ({ ...f, maxCapacity: parseInt(e.target.value) || 10 }))}
            min={1} max={100}
             variant="default"
            className="px-2.5 text-[12px]" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="available" checked={form.available}
          onChange={e => setForm(f => ({ ...f, available: e.target.checked }))}
          className="rounded border-border text-brand focus:ring-brand" />
        <label htmlFor="available" className="text-[12px] text-foreground">Available for tickets</label>
      </div>
      <Button size="xs" onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending} className="w-full">
        <Check size={12} className="mr-1" /> Save Profile
      </Button>
    </div>
  );
}

function RoutingTab({ memberId, workspaceId }: { memberId: string; workspaceId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [keywordsText, setKeywordsText] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [priority, setPriority] = useState(0);
  const [active, setActive] = useState(true);

  const { data: routing } = useQuery({
    queryKey: [`/api/workspace-members/${memberId}/routing`],
    queryFn: async () => {
      const res = await fetch(`/api/workspace-members/${memberId}/routing`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  useEffect(() => {
    if (routing) {
      setKeywords(routing.keywords ?? []);
      setSkills(routing.skills ?? []);
      setPriority(routing.priority ?? 0);
      setActive(routing.active ?? true);
    }
  }, [routing]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspace-members/${memberId}/routing`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, skills, priority, active }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/workspace-members/${memberId}/routing`] });
      toast({ title: 'Routing config saved', variant: 'success' });
    },
  });

  const addKeyword = () => {
    const t = keywordsText.trim().toLowerCase();
    if (t && !keywords.includes(t)) { setKeywords([...keywords, t]); setKeywordsText(''); }
  };

  const toggleSkill = (skill: string) => {
    setSkills(prev => prev.includes(skill) ? prev.filter(s => s !== skill) : [...prev, skill]);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-[11px] font-medium text-foreground mb-1">Keywords</label>
        <p className="text-[10px] text-fg-faint mb-1.5">When a ticket contains these words, this member gets priority.</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {keywords.map(k => (
            <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/5 text-brand text-[11px]">
              {k}
              <button onClick={() => setKeywords(keywords.filter(x => x !== k))} className="hover:text-red-500"><X size={10} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <TextInput value={keywordsText} onChange={e => setKeywordsText(e.target.value)}
            placeholder="Type keyword" className="flex-1" 
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }} />
          <Button size="xs" onClick={addKeyword} disabled={!keywordsText.trim()}>Add</Button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-foreground mb-1">Skills</label>
        <p className="text-[10px] text-fg-faint mb-1.5">Match tickets by skill tag.</p>
        <div className="flex flex-wrap gap-1">
          {SKILL_SUGGESTIONS.map(s => (
            <button key={s} onClick={() => toggleSkill(s)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                skills.includes(s) ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface-hover text-fg-muted border-border hover:border-fg-muted'
              }`}>
              {skills.includes(s) ? '✓ ' : ''}{s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <label className="block text-[11px] font-medium text-foreground mb-1">Priority</label>
          <input type="range" min={0} max={10} value={priority} onChange={e => setPriority(Number(e.target.value))}
            className="w-24" />
          <span className="text-[11px] text-fg-muted ml-2">{priority}</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="routing-active" checked={active}
            onChange={e => setActive(e.target.checked)}
            className="rounded border-border text-brand focus:ring-brand" />
          <label htmlFor="routing-active" className="text-[12px] text-foreground">Active</label>
        </div>
      </div>

      <Button size="xs" onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending} className="w-full">
        <Check size={12} className="mr-1" /> Save Routing
      </Button>
    </div>
  );
}

function ScheduleTab({ member, workspaceId }: { member: Member; workspaceId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [schedule, setSchedule] = useState<Record<string, { start: string; end: string } | null>>(member.schedule || {});

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${member.id}/schedule`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule }),
      });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['member', workspaceId, member.id] });
      toast({ title: 'Schedule saved', variant: 'success' });
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-fg-muted mb-3">Set working hours for each day. Leave a day empty or set to off.</p>
      {DAYS.map(day => (
        <div key={day} className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-foreground w-24 capitalize">{day.slice(0, 3)}</span>
          {schedule[day] ? (
            <>
              <TextInput type="time" value={schedule[day]!.start} onChange={e => setSchedule(s => ({ ...s, [day]: { ...s[day]!, start: e.target.value } }))}
                 variant="default"
                className="px-2 text-[11px]" />
              <span className="text-[11px] text-fg-faint">to</span>
              <TextInput type="time" value={schedule[day]!.end} onChange={e => setSchedule(s => ({ ...s, [day]: { ...s[day]!, end: e.target.value } }))}
                 variant="default"
                className="px-2 text-[11px]" />
              <button onClick={() => setSchedule(s => ({ ...s, [day]: null }))}
                className="text-[10px] text-red-500 hover:text-red-700 ml-1">Off</button>
            </>
          ) : (
            <button onClick={() => setSchedule(s => ({ ...s, [day]: { start: '09:00', end: '17:00' } }))}
              className="text-[11px] text-brand hover:underline">+ Set hours</button>
          )}
        </div>
      ))}
      <Button size="xs" onClick={() => saveMutation.mutate()} isLoading={saveMutation.isPending} className="w-full mt-3">
        <Check size={12} className="mr-1" /> Save Schedule
      </Button>
    </div>
  );
}

function ActivityTab({ memberId, workspaceId }: { memberId: string; workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-activity', workspaceId, memberId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}/activity`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  const activity: Array<{ id: string; action: string; details: Record<string, unknown>; createdAt: string }> = data?.activity ?? [];

  const actionIcons: Record<string, string> = {
    profile_updated: '✏️',
    role_changed: '🔄',
    login: '🔑',
    ticket_assigned: '🎫',
    ticket_resolved: '✅',
    reply_sent: '📨',
  };

  const actionLabels: Record<string, string> = {
    profile_updated: 'Profile updated',
    role_changed: 'Role changed',
    login: 'Logged in',
    ticket_assigned: 'Ticket assigned',
    ticket_resolved: 'Ticket resolved',
    reply_sent: 'Sent reply',
  };

  if (isLoading) return <ListSkeleton rows={4} />;

  return (
    <div className="space-y-2">
      {activity.length === 0 ? (
        <p className="text-[12px] text-fg-muted text-center py-8">No activity yet</p>
      ) : (
        activity.map(a => (
          <div key={a.id} className="flex items-start gap-2 p-2.5 rounded-lg bg-surface-muted/50">
            <span className="text-[14px] shrink-0">{actionIcons[a.action] || '📋'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-foreground">{actionLabels[a.action] || a.action}</p>
              <p className="text-[10px] text-fg-faint">{new Date(a.createdAt).toLocaleString()}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function PermissionsTab({ memberId, workspaceId, spaces }: { memberId: string; workspaceId: string; spaces: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedSpaces, setSelectedSpaces] = useState<Set<string>>(new Set());
  const [role, setRole] = useState('viewer');

  const { data: member } = useQuery({
    queryKey: ['member', workspaceId, memberId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  useEffect(() => {
    if (member) {
      setRole(member.role);
      setSelectedSpaces(new Set(member.spaceIds || []));
    }
  }, [member]);

  const saveRole = async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}/role`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) throw new Error('Failed');
      qc.invalidateQueries({ queryKey: ['member', workspaceId, memberId] });
      qc.invalidateQueries({ queryKey: [`/api/workspaces/${workspaceId}/members`] });
      toast({ title: 'Permissions updated', variant: 'success' });
    } catch { toast({ title: 'Update failed', variant: 'destructive' }); }
  };

  const saveSpaces = async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}/spaces`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ spaceIds: Array.from(selectedSpaces) }),
      });
      if (!res.ok) throw new Error('Failed');
      qc.invalidateQueries({ queryKey: ['member', workspaceId, memberId] });
      toast({ title: 'Space access updated', variant: 'success' });
    } catch { toast({ title: 'Update failed', variant: 'destructive' }); }
  };

  const toggleSpace = (id: string) => {
    setSelectedSpaces(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!member) return <div className="flex justify-center py-8"><Loader size={14} className="animate-spin text-fg-muted" /></div>;

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-[11px] font-medium text-foreground mb-1.5">Role</label>
        <div className="flex gap-2">
          {['viewer', 'editor'].map(r => (
            <button key={r} onClick={() => setRole(r)}
              className={`text-[12px] px-3 py-1.5 rounded-[8px] border transition-colors ${
                role === r ? 'bg-brand/10 text-brand border-brand/30' : 'bg-surface-hover text-fg-muted border-border'
              }`}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
          <Button size="xs" onClick={saveRole} disabled={role === member.role}><Check size={11} className="mr-1" /> Save</Button>
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-foreground mb-1.5">Space Access</label>
        <p className="text-[10px] text-fg-faint mb-2">Choose which inboxes this member can access.</p>
        <div className="space-y-1">
          {spaces.map(s => (
            <label key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-hover cursor-pointer">
              <input type="checkbox" checked={selectedSpaces.has(s.id)} onChange={() => toggleSpace(s.id)}
                className="rounded border-border text-brand focus:ring-brand" />
              <span className="text-[12px] text-foreground">{s.name}</span>
            </label>
          ))}
        </div>
        {spaces.length > 0 && (
          <div className="flex gap-2 mt-2">
            <Button size="xs" design="ghost" onClick={() => setSelectedSpaces(new Set(spaces.map(s => s.id)))}>Select all</Button>
            <Button size="xs" design="ghost" onClick={() => setSelectedSpaces(new Set())}>Clear</Button>
            <Button size="xs" onClick={saveSpaces}><Check size={11} className="mr-1" /> Save</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function PerformanceTab({ memberId, workspaceId }: { memberId: string; workspaceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['member-performance', workspaceId, memberId],
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}/performance`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed');
      return res.json();
    },
  });

  if (isLoading) return <ListSkeleton rows={4} />;

  const current = data?.current;
  const history: Array<{ ticketsResolved: number; avgResponseTime: number; customerSatisfaction: number; repliesSent: number }> = data?.history || [];

  return (
    <div className="space-y-4">
      {current ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl bg-blue-50 border border-blue-100">
              <p className="text-[10px] font-medium text-blue-600 uppercase">Resolved</p>
              <p className="text-[20px] font-bold text-blue-900">{current.ticketsResolved}</p>
              <p className="text-[10px] text-blue-500">this period</p>
            </div>
            <div className="p-3 rounded-xl bg-green-50 border border-green-100">
              <p className="text-[10px] font-medium text-green-600 uppercase">Response</p>
              <p className="text-[20px] font-bold text-green-900">{formatDuration(current.avgResponseTime)}</p>
              <p className="text-[10px] text-green-500">avg time</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-muted border border-amber-border">
              <p className="text-[10px] font-medium text-amber uppercase">Satisfaction</p>
              <p className="text-[20px] font-bold text-amber">{current.customerSatisfaction.toFixed(1)}</p>
              <p className="text-[10px] text-amber">/ 5.0</p>
            </div>
            <div className="p-3 rounded-xl bg-purple-50 border border-purple-100">
              <p className="text-[10px] font-medium text-purple-600 uppercase">Replies</p>
              <p className="text-[20px] font-bold text-purple-900">{current.repliesSent}</p>
              <p className="text-[10px] text-purple-500">sent</p>
            </div>
          </div>

          {history.length > 1 && (
            <div>
              <p className="text-[11px] font-medium text-foreground mb-2">History</p>
              <div className="space-y-1">
                {history.slice(0, 6).map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded-lg bg-surface-muted/50">
                    <span className="text-fg-faint w-20">Period {history.length - i}</span>
                    <span className="text-fg-muted">{h.ticketsResolved} resolved</span>
                    <span className="text-fg-faint">·</span>
                    <span className="text-fg-muted">{formatDuration(h.avgResponseTime)} avg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-[12px] text-fg-muted text-center py-8">No performance data yet</p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}


