import { useState } from 'react';
import { Plus, Search, ComponentIcon } from 'lucide-react';
import { Button } from '@/components/button';

const COMPONENTS = [
  { id: '1', name: 'Button', variants: 4, updated: '1 day ago' },
  { id: '2', name: 'Card', variants: 3, updated: '2 days ago' },
  { id: '3', name: 'Navigation Bar', variants: 2, updated: '3 days ago' },
  { id: '4', name: 'Input Field', variants: 5, updated: '4 days ago' },
  { id: '5', name: 'Modal Dialog', variants: 2, updated: '1 week ago' },
  { id: '6', name: 'Dropdown Menu', variants: 3, updated: '1 week ago' },
];

export default function ComponentsPage() {
  const [search, setSearch] = useState('');

  const filtered = COMPONENTS.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-4 sm:py-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Components</h1>
          <Button size="sm">
            <Plus size={15} />
            New component
          </Button>
        </div>

        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search components..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {filtered.map((component) => (
            <div
              key={component.id}
              onClick={() => {}}
              className="group rounded-[12px] border border-border bg-background hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer overflow-hidden"
            >
              <div className="aspect-[16/10] bg-surface-hover flex items-center justify-center">
                <ComponentIcon size={24} className="text-fg-faint" strokeWidth={1.5} />
              </div>
              <div className="h-px bg-border/60" />
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium text-foreground truncate">{component.name}</p>
                <p className="text-[11px] text-fg-faint mt-0.5">{component.variants} variants · {component.updated}</p>
              </div>
            </div>
          ))}
          <div
            onClick={() => {}}
            className="rounded-[12px] border border-dashed border-border bg-background hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer flex flex-col items-center justify-center gap-2 min-h-[180px]"
          >
            <Plus size={22} className="text-fg-faint" strokeWidth={1.5} />
            <span className="text-[13px] font-medium text-fg-muted">New component</span>
          </div>
        </div>
      </div>
    </div>
  );
}
