import { useState } from 'react';
import { Search, Image, Upload } from 'lucide-react';
import { Button } from '@/components/button';

const ASSETS = [
  { id: '1', name: 'hero-bg.png', type: 'Image', size: '2.4 MB', updated: '1 day ago' },
  { id: '2', name: 'logo.svg', type: 'SVG', size: '48 KB', updated: '2 days ago' },
  { id: '3', name: 'icon-set.png', type: 'Image', size: '1.1 MB', updated: '3 days ago' },
  { id: '4', name: 'font-regular.woff2', type: 'Font', size: '120 KB', updated: '5 days ago' },
  { id: '6', name: 'pattern.svg', type: 'SVG', size: '16 KB', updated: '2 weeks ago' },
];

export default function AssetsPage() {
  const [search, setSearch] = useState('');

  const filtered = ASSETS.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-y-auto">
      <div className="flex-1 px-4 sm:px-6 md:px-8 py-4 sm:py-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-[22px] font-semibold text-foreground tracking-tight">Assets</h1>
          <Button size="sm">
            <Upload size={15} />
            Upload asset
          </Button>
        </div>

        <div className="relative mb-6">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets..."
            className="w-full h-[36px] pl-9 pr-3 rounded-[10px] text-[14px] text-foreground placeholder:text-fg-faint bg-surface-hover border-none outline-none"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Image size={32} className="text-fg-faint mb-3" strokeWidth={1.5} />
            <p className="text-[14px] font-medium text-foreground">No assets yet</p>
            <p className="text-[12px] text-fg-muted mt-1">Upload your first asset to get started.</p>
          </div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              onClick={() => {}}
              className="group rounded-[12px] border border-border bg-background hover:shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-150 cursor-pointer overflow-hidden"
            >
              <div className="aspect-[16/10] bg-surface-hover flex items-center justify-center">
                <Image size={28} className="text-fg-faint" strokeWidth={1.5} />
              </div>
              <div className="h-px bg-border/60" />
              <div className="px-3 py-2">
                <p className="text-[13px] font-medium text-foreground truncate">{asset.name}</p>
                <p className="text-[11px] text-fg-faint mt-0.5">{asset.type} · {asset.size}</p>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
