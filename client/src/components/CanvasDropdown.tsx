import { useState, useRef, useEffect, type ReactNode } from "react";

interface CanvasDropdownOption<T = string> {
  value: T;
  label: ReactNode;
  type?: "default" | "divider";
  variant?: "default" | "danger";
}

interface CanvasDropdownProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options: CanvasDropdownOption<T>[];
  children: ReactNode;
  align?: "left" | "center" | "right";
}

export function CanvasDropdown<T extends string = string>({
  value,
  onChange,
  options,
  children,
  align = "left",
}: CanvasDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen(!open)}>{children}</div>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className={`absolute z-20 top-full mt-1.5 min-w-[140px] bg-surface-hover rounded-[8px] p-1 space-y-1 shadow-[0_1px_4px_rgba(0,0,0,0.06)] ${
              align === "center" ? "left-1/2 -translate-x-1/2" : align === "right" ? "right-0" : "left-0"
            }`}
          >
            {options.map((opt) =>
              opt.type === "divider" ? (
                <div key={String(opt.value)} className="h-px bg-border/50 -mx-1" />
              ) : (
                <button
                  key={String(opt.value)}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className={`flex w-full items-center px-2 py-1 rounded-[6px] text-[11px] font-medium text-left transition-colors border-none cursor-pointer ${
                    opt.variant === "danger"
                      ? opt.value === value
                        ? "bg-danger text-white"
                        : "text-foreground hover:bg-danger hover:text-white"
                      : opt.value === value
                        ? "bg-brand text-white"
                        : "text-foreground hover:bg-brand hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
