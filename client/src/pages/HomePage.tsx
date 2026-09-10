import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@/hooks/use-user';
import { PromptInput } from '@/components/PromptInput';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight } from 'lucide-react';
import { useLocation } from 'wouter';
import { randomProjectName } from '@/lib/utils';

interface ApiProject {
  id: string;
  name: string;
  updatedAt: string;
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

export default function HomePage() {
  const { data: user } = useUser();
  const [, setLocation] = useLocation();
  const [loading, setLoading] = useState(false);

  /* Pick up a prompt typed on the landing hero and prefill it for review. */
  const [landingPrompt] = useState<string | undefined>(() => {
    const v = sessionStorage.getItem('cortardo-landing-prompt');
    if (v) sessionStorage.removeItem('cortardo-landing-prompt');
    return v ?? undefined;
  });

  const { data: projects = [], isLoading: projectsLoading } = useQuery<ApiProject[]>({
    queryKey: ['/api/projects'],
    queryFn: async () => {
      const res = await fetch('/api/projects', { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30_000,
  });

  const recentProjects = projects.slice(0, 3);

  const handlePrompt = async (prompt: string, options?: { model?: string; reasoning?: string }) => {
    setLoading(true);
    try {
      if (options?.model) sessionStorage.setItem('cortardo-model', options.model);
      if (options?.reasoning) sessionStorage.setItem('cortardo-reasoning', options.reasoning);
      const res = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: randomProjectName(),
          description: prompt,
          kind: "cortardo",
        }),
      });
      if (res.ok) {
        const project = await res.json();
        sessionStorage.setItem('cortardo-prompt', prompt);
        setLocation(`/canvas/${project.id}`);
        return;
      }
    } catch {}
    sessionStorage.setItem('cortardo-prompt', prompt);
    setLocation('/canvas/new');
  };

  const firstName = user?.displayName?.split(' ')[0] || user?.email?.split('@')[0] || 'there';

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 flex flex-col items-center pt-16 sm:pt-36 pb-8 sm:pb-12 px-4 sm:px-6 max-w-4xl mx-auto w-full">
        {/* Welcome */}
        <div className="text-center mb-3 sm:mb-6 pt-3 sm:pt-6">
          <h1 className="text-[22px] sm:text-[30px] font-semibold text-foreground tracking-tight">
            What are we reviewing, {firstName}?
          </h1>
        </div>

        {/* Prompt Box */}
        <PromptInput onSubmit={handlePrompt} isLoading={loading} initialValue={landingPrompt} showFocusPlaceholder={false} />

        {/* Recent Projects */}
        <div className="w-full max-w-3xl mx-auto mt-14 sm:mt-36">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[18px] font-semibold text-foreground">Recent</h2>
            <button
              onClick={() => setLocation('/home/projects')}
              className="flex items-center gap-1 text-[13px] font-medium text-fg-muted hover:text-foreground transition-colors border-none bg-transparent cursor-pointer"
            >
              View all <ArrowRight size={13} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 pb-2">
            {projectsLoading && (
              <>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-[12px] border border-border bg-background overflow-hidden">
                    <Skeleton className="aspect-[16/10] w-full rounded-none" />
                    <div className="px-3 py-2 space-y-1.5">
                      <Skeleton className="h-3.5 w-2/3" />
                      <Skeleton className="h-2.5 w-1/4" />
                    </div>
                  </div>
                ))}
              </>
            )}
            {!projectsLoading && recentProjects.length === 0 && (
              <div className="col-span-3 text-center py-8">
                <p className="text-[13px] text-fg-muted">No projects yet. Connect a repository above.</p>
              </div>
            )}
            {recentProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => setLocation(`/canvas/${project.id}`)}
                className="group rounded-[12px] border border-border bg-background hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] hover:-translate-y-1 transition-all duration-150 cursor-pointer overflow-hidden"
              >
                <div className="aspect-[16/10] bg-surface-hover flex items-center justify-center">
                  <span className="text-[11px] text-fg-muted font-medium">No Preview</span>
                </div>
                <div className="h-px bg-border/60" />
                <div className="px-3 py-2">
                  <p className="text-[13px] font-medium text-foreground truncate">{project.name}</p>
                  <p className="text-[11px] text-fg-faint mt-0.5">{timeAgo(project.updatedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
