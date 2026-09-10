import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspace } from '@/contexts/workspace-context';

interface ApiProject {
  id: string;
  name: string;
  description?: string | null;
  color?: string;
  updatedAt: string;
  createdAt: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function ProjectsPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const { activeWorkspaceId } = useWorkspace();

  const { data: projects = [], isLoading } = useQuery<ApiProject[]>({
    queryKey: ['/api/projects', activeWorkspaceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects${activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : ''}`,
        { credentials: 'include' }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-4 sm:py-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Projects</h1>
          <Button size="sm" onClick={() => setLocation('/canvas/new')}>
            <Plus size={15} />
            New project
          </Button>
        </div>

        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-[12px] border border-border bg-background overflow-hidden">
                <Skeleton className="aspect-[16/10] w-full rounded-none" />
                <div className="px-3 py-2 space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-2.5 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[14px] text-fg-muted">No projects yet</p>
            <Button size="sm" onClick={() => setLocation('/canvas/new')} className="mt-4">
              Create your first project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {filtered.map((project) => (
              <div
                key={project.id}
                onClick={() => setLocation(`/canvas/${project.id}`)}
                className="group rounded-[12px] border border-border bg-background hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-150 cursor-pointer overflow-hidden"
              >
                <div
                  className="aspect-[16/10] flex items-center justify-center"
                  style={{ backgroundColor: project.color || '#f0f0f0' }}
                >
                  <span className="text-[11px] font-medium" style={{ color: project.color ? '#fff' : '#999' }}>
                    {project.name.slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="h-px bg-border/60" />
                <div className="px-3 py-2">
                  <p className="text-[13px] font-medium text-foreground truncate">{project.name}</p>
                  <p className="text-[11px] text-fg-faint mt-0.5">{timeAgo(project.updatedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
