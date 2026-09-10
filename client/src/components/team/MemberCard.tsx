import { X, UserCog } from 'lucide-react';
import { IconButton } from '@/components/button';

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
  department?: string | null;
  title?: string | null;
  skills: MemberSkill[];
  maxCapacity: number;
  timezone?: string | null;
  available: boolean;
  currentTicketCount: number;
  lastActiveAt?: string | null;
}

interface MemberCardProps {
  member: Member;
  canManage: boolean;
  onEdit: (member: Member) => void;
  onRemove: (memberId: string) => void;
  onToggleAvailable: (memberId: string, available: boolean) => void;
}

export function MemberCard({ member, canManage, onEdit, onRemove, onToggleAvailable }: MemberCardProps) {
  const loadPct = member.maxCapacity > 0
    ? Math.round(((member.currentTicketCount ?? 0) / member.maxCapacity) * 100)
    : 0;

  const name = member.displayName || member.email.split('@')[0];
  const roleColors: Record<string, string> = {
    owner: 'bg-violet-50 text-violet-600 border-violet-200',
    editor: 'bg-blue-50 text-blue-600 border-blue-200',
    viewer: 'bg-surface-muted text-fg-muted border-border',
  };

  return (
    <div className="rounded-[14px] border border-border bg-background p-4 transition-colors hover:bg-surface-hover/50">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {member.avatarUrl ? (
            <img src={member.avatarUrl} alt={name} className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand/20 to-brand/5 flex items-center justify-center">
              <span className="text-[14px] font-semibold text-brand">{name.charAt(0).toUpperCase()}</span>
            </div>
          )}
          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${member.available ? 'bg-green-500' : 'bg-gray-300'}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground truncate">{name}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${roleColors[member.role] || roleColors.viewer}`}>
              {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
            </span>
            {member.status === 'pending' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-muted text-amber border border-amber-border">
                Pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-fg-muted truncate">{member.email}</p>
          {(member.department || member.title) && (
            <p className="text-[11px] text-fg-faint mt-0.5">
              {member.department}{member.department && member.title ? ' · ' : ''}{member.title}
            </p>
          )}

          {member.skills && member.skills.length > 0 && (
            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
              {member.skills.slice(0, 3).map(s => (
                <span key={s.skill} className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand/5 text-brand/80">
                  {s.skill} {'★'.repeat(s.proficiency)}{'☆'.repeat(5 - s.proficiency)}
                </span>
              ))}
              {member.skills.length > 3 && (
                <span className="text-[10px] text-fg-faint">+{member.skills.length - 3}</span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-fg-muted">Load:</span>
              <div className="w-16 h-1.5 rounded-full bg-border-subtle overflow-hidden">
                <div className={`h-full rounded-full transition-all ${loadPct > 80 ? 'bg-red-500' : loadPct > 60 ? 'bg-amber' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(loadPct, 100)}%` }} />
              </div>
              <span className="text-[10px] text-fg-muted">{member.currentTicketCount ?? 0}/{member.maxCapacity ?? 10}</span>
            </div>
            {member.timezone && (
              <span className="text-[10px] text-fg-faint">{member.timezone}</span>
            )}
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-1 shrink-0">
            {member.status === 'active' && (
              <button
                onClick={() => onToggleAvailable(member.id, !member.available)}
                className={`px-2 py-1 rounded-[8px] text-[10px] font-medium transition-colors ${
                  member.available ? 'bg-green-50 text-green-600' : 'bg-surface-hover text-fg-muted'
                }`}
              >
                {member.available ? 'Online' : 'Away'}
              </button>
            )}
            <IconButton icon={UserCog} size="xs" design="ghost" onClick={() => onEdit(member)} title="Edit member" />
            {member.role !== 'owner' && (
              <IconButton icon={X} size="xs" design="ghost" onClick={() => onRemove(member.id)} title="Remove member" className="hover:text-destructive hover:bg-red-50" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
