import { useState, useRef, useEffect } from 'react';
import { Check } from 'lucide-react';
import { TextInput } from "@/components/text-input";
import { Button } from '@/components/button';

const PRESETS = [
  '#4682B4', '#f59e0b', '#8b5cf6', '#ef4444',
  '#10b981', '#ec4899', '#3b82f6', '#f97316',
  '#84cc16', '#06b6d4', '#dc2626', '#7c3aed',
  '#2563eb', '#d946ef', '#22c55e', '#64748b',
  '#000000', '#ffffff',
];

interface ColorPickerProps {
  value: string;
  onChange: (v: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    setHex(value);
  }, [value]);

  const applyHex = () => {
    const cleaned = hex.trim();
    const valid = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned)
      ? cleaned
      : /^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(cleaned)
        ? '#' + cleaned
        : null;
    if (valid) {
      onChange(valid);
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="relative" style={{ width: 120 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 w-full h-8 px-2.5 rounded-[10px] border border-border bg-background cursor-pointer hover:border-brand/40 transition-colors duration-150"
      >
        <div
          className="shrink-0 w-4 h-4 rounded-full border border-black/10"
          style={{ backgroundColor: value }}
        />
        <span className="text-[12px] font-mono text-foreground">{value}</span>
      </button>

      {open && (
        <div
          className="absolute z-50 left-0 top-full mt-1.5 bg-background border border-border rounded-[16px] p-2"
          style={{ width: 252 }}
        >
          <div className="grid grid-cols-9 gap-1.5 mb-2.5">
            {PRESETS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => { onChange(c); setOpen(false); }}
                className="w-[22px] h-[22px] rounded-full border border-black/10 hover:scale-110 transition-transform cursor-pointer relative flex items-center justify-center"
                style={{ backgroundColor: c }}
              >
                {c === value && (
                  <Check
                    size={10}
                    strokeWidth={3}
                    style={{ color: c === '#ffffff' || c === '#000000' ? (c === '#ffffff' ? '#000' : '#fff') : '#fff' }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <input
                type="color"
                value={value}
                onChange={e => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 w-[28px] h-[28px] cursor-pointer"
              />
              <div
                className="w-[28px] h-[28px] rounded-md border border-black/10"
                style={{ backgroundColor: value }}
              />
            </div>
            <TextInput
              value={hex}
              onChange={e => setHex(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); applyHex(); } }}
              placeholder="#000000"
              variant="default"
              className="flex-1 h-[28px] px-2 text-[12px] font-mono bg-surface-muted border-border/60"
            />
            <Button type="button" design="ghost" size="xs" className="shrink-0" onClick={applyHex}>
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
