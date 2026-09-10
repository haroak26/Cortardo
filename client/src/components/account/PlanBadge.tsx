type Plan = { id: string; label: string; price: number; period: string; features: string[] };

const planColors: Record<string, string> = {
  free: 'bg-gray-100 text-gray-600',
  starter: 'bg-blue-100 text-blue-700',
  pro: 'bg-purple-100 text-purple-700',
  max: 'bg-amber-muted text-amber',
};

export function StatusPill({ verified }: { verified: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${verified ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-muted text-amber'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${verified ? 'bg-emerald-500' : 'bg-amber'}`} />
      {verified ? 'Verified' : 'Unverified'}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: Plan }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[12px] font-medium ${planColors[plan.id] || 'bg-gray-100 text-gray-600'}`}>{plan.label}</span>;
}

export function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = { owner: 'bg-amber-muted text-amber', editor: 'bg-blue-100 text-blue-700', viewer: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium ${colors[role] || 'bg-gray-100 text-gray-600'}`}>{role}</span>;
}
