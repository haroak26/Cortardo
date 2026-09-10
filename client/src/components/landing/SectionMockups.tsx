import type { CSSProperties, ReactNode } from "react";
import { ArrowDown, Check, FileDiff, MousePointer2, ShieldCheck } from "lucide-react";

/* Shared window chrome for the landing section mockups. */

function MockWindow({
  label,
  dark = false,
  children,
}: {
  label: string;
  dark?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative w-full max-w-[440px] rounded-xl overflow-hidden shadow-[0_28px_70px_-28px_rgba(15,23,42,0.35)] ${
        dark ? "bg-[#10131b] ring-1 ring-white/10" : "bg-white ring-1 ring-black/[0.08]"
      }`}
    >
      <div
        className={`flex items-center gap-1.5 h-8 px-3.5 border-b ${
          dark ? "border-white/[0.07] bg-white/[0.03]" : "border-black/[0.05] bg-black/[0.015]"
        }`}
      >
        <span className="w-2 h-2 rounded-full bg-[#ff5f57]/80" />
        <span className="w-2 h-2 rounded-full bg-[#febc2e]/80" />
        <span className="w-2 h-2 rounded-full bg-[#28c840]/80" />
        <span
          className={`mx-auto text-[10.5px] font-medium truncate ${
            dark ? "text-white/40" : "text-slate-400"
          }`}
        >
          {label}
        </span>
        <span className="w-9 shrink-0" />
      </div>
      {children}
    </div>
  );
}

/* Mini diff — a believable pull-request file view. */

function MiniDiff({ selected = false }: { selected?: boolean }) {
  return (
    <div className="relative w-[180px] shrink-0 rounded-lg bg-white ring-1 ring-slate-200 shadow-[0_12px_28px_-14px_rgba(15,23,42,0.3)]">
      {selected && (
        <>
          <div className="pointer-events-none absolute -inset-[3px] rounded-[10px] border-[1.5px] border-[#284B63]" />
          <span className="absolute -top-[20px] left-0 text-[9.5px] font-semibold text-[#284B63] bg-white px-1 rounded-sm">
            auth.ts · +42 −6
          </span>
        </>
      )}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px] bg-[#284B63]" />
          <span className="h-1.5 w-8 rounded-full bg-slate-300" />
        </div>
        <span className="h-3 w-8 rounded-full bg-[#284B63]" />
      </div>
      <div className="px-3 pb-3 font-mono text-[6px] leading-[1.6]">
        <div className="h-[6px] w-11/12 rounded-full bg-slate-800" />
        <div className="h-[6px] w-3/4 rounded-full bg-slate-800 mt-1" />
        <div className="h-[5px] w-full rounded-full bg-emerald-200 mt-2" />
        <div className="h-[5px] w-5/6 rounded-full bg-emerald-200 mt-1" />
        <div className="h-[5px] w-4/5 rounded-full bg-rose-200 mt-1" />
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="h-4 w-12 rounded-[4px] bg-[#284B63]" />
          <span className="h-4 w-10 rounded-[4px] bg-slate-100 ring-1 ring-slate-200" />
        </div>
        <div className="mt-2.5 h-10 rounded-md bg-gradient-to-br from-slate-100 to-slate-200 ring-1 ring-slate-200/70 flex items-center justify-center">
          <FileDiff size={12} className="text-slate-300" />
        </div>
      </div>
    </div>
  );
}

function MiniMobileDiff() {
  return (
    <div className="relative w-[104px] shrink-0 rotate-2 rounded-lg bg-white ring-1 ring-slate-200 shadow-[0_12px_28px_-14px_rgba(15,23,42,0.3)]">
      <span className="absolute -top-[20px] left-0 text-[9.5px] font-semibold text-slate-400">
        api.ts
      </span>
      <div className="px-2.5 pt-2.5 pb-3 font-mono">
        <div className="h-[5px] w-10/12 rounded-full bg-slate-800" />
        <div className="h-[5px] w-2/3 rounded-full bg-slate-800 mt-1" />
        <div className="h-[4px] w-full rounded-full bg-emerald-200 mt-2" />
        <div className="h-[4px] w-4/5 rounded-full bg-rose-200 mt-1" />
        <div className="mt-2 h-4 w-full rounded-[4px] bg-[#284B63]" />
        <div className="mt-1.5 h-9 rounded-md bg-gradient-to-br from-slate-100 to-slate-200 ring-1 ring-slate-200/70" />
      </div>
    </div>
  );
}

/* [01] Prompt → review */

export function HowItWorksMockup() {
  return (
    <MockWindow label="app.cortardo.com/reviews/checkout-service">
      <div className="px-4 pt-4 pb-4">
        <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 pl-3 pr-1.5 py-1.5">
          <span className="h-2 w-2 rounded-full bg-[#284B63] shrink-0" />
          <span className="text-[11.5px] text-slate-600 font-medium truncate">
            Review the checkout service PR — focus on billing edge cases…
          </span>
          <span className="ml-auto h-5 w-5 rounded-full bg-[#284B63] flex items-center justify-center shrink-0">
            <MousePointer2 size={10} className="text-white -rotate-45" />
          </span>
        </div>

        <div className="flex justify-center py-2.5 text-slate-300">
          <ArrowDown size={14} strokeWidth={2} />
        </div>

        <div className="flex items-start justify-center gap-4">
          <MiniDiff selected />
          <MiniMobileDiff />
        </div>

        <div className="mt-4 mx-auto w-fit flex items-center gap-1.5 rounded-full bg-emerald-50 ring-1 ring-emerald-100 px-3 py-1.5">
          <span className="live-blink h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="text-[10.5px] font-semibold text-emerald-700">
            12 findings posted · 3 fixes ready
          </span>
        </div>
      </div>
    </MockWindow>
  );
}

/* [03] Live collaboration */

const COLLAB_CURSORS: { name: string; color: string; className: string; style: CSSProperties }[] = [
  { name: "Ava", color: "#f0abfc", className: "cursor-drift-1", style: { left: "12%", top: "30%" } },
  { name: "Liam", color: "#7dd3fc", className: "cursor-drift-2", style: { left: "62%", top: "58%" } },
];

function CursorTag({
  name,
  color,
  className,
  style,
}: {
  name: string;
  color: string;
  className: string;
  style: CSSProperties;
}) {
  return (
    <div className={`absolute z-20 ${className}`} style={style}>
      <MousePointer2 size={13} fill={color} color={color} className="drop-shadow-sm" />
      <span
        className="ml-3 -mt-1 absolute whitespace-nowrap text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md rounded-tl-sm text-black/80"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  );
}

export function CollabMockup() {
  return (
    <MockWindow label="app.cortardo.com/reviews/onboarding-v2">
      <div className="relative h-[252px] sm:h-[268px]">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(hsl(220 14% 45% / 0.14) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
          }}
        />

        {/* Live collaborators */}
        <div className="absolute right-3 top-3 z-10 flex -space-x-1.5">
          {[
            { i: "A", c: "bg-fuchsia-200 text-fuchsia-900" },
            { i: "L", c: "bg-sky-200 text-sky-900" },
            { i: "M", c: "bg-slate-200 text-slate-700" },
          ].map((a) => (
            <span
              key={a.i}
              className={`flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-white text-[9px] font-bold ${a.c}`}
            >
              {a.i}
            </span>
          ))}
        </div>

        {/* Diff under review */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-1">
          <MiniDiff selected />
        </div>

        {COLLAB_CURSORS.map((c) => (
          <CursorTag key={c.name} {...c} />
        ))}

        {/* Resolved comment */}
        <div className="absolute left-[6%] bottom-[9%] z-10 w-[152px] rounded-lg bg-white ring-1 ring-slate-200 shadow-[0_12px_30px_-12px_rgba(15,23,42,0.3)] p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[7px] font-bold text-white">
              MC
            </span>
            <span className="text-[9.5px] font-semibold text-slate-700">Maya</span>
            <span className="ml-auto inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-1.5 py-px text-[8.5px] font-semibold text-emerald-600">
              <Check size={7} strokeWidth={3} />
              Resolved
            </span>
          </div>
          <div className="mt-1.5 space-y-1">
            <div className="h-1 rounded-full bg-slate-200 w-full" />
            <div className="h-1 rounded-full bg-slate-200 w-3/4" />
          </div>
        </div>

        {/* Merge chip */}
        <div className="absolute right-3 bottom-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-[#284B63] px-2.5 py-1.5 text-[10px] font-semibold text-white shadow-[0_8px_20px_-6px_rgba(40,75,99,0.6)]">
          <ShieldCheck size={10} strokeWidth={2.5} />
          Review passed · ready to merge
        </div>
      </div>
    </MockWindow>
  );
}

/* [04] Inline fix */

const CODE_LINES: { t: string; c: string }[][] = [
  [{ t: "if (user === null)", c: "text-[#9fc3d4]" }, { t: " {", c: "text-white/25" }],
  [
    { t: "  return", c: "text-[#c4b5fd]" },
    { t: " ", c: "text-white/25" },
    { t: "null", c: "text-[#fbbf24]" },
    { t: ";", c: "text-white/25" },
  ],
  [{ t: "}", c: "text-white/25" }],
  [
    { t: "- return user.name", c: "text-[#fda4af]" },
    { t: "  // ← possible null deref", c: "text-white/30" },
  ],
  [
    { t: "+ return user?.name ??", c: "text-[#86efac]" },
    { t: " ", c: "text-white/25" },
    { t: '"guest"', c: "text-[#fbbf24]" },
    { t: ";", c: "text-white/25" },
  ],
  [{ t: "// fix applied · tests passing", c: "text-white/25" }],
];

export function ExportMockup() {
  return (
    <MockWindow dark label="auth.ts — suggested fix">
      <div className="px-4 pt-3.5 pb-2 font-mono text-[10.5px] leading-[2] overflow-x-auto">
        {CODE_LINES.map((line, i) => (
          <div key={i} className="flex whitespace-pre">
            <span className="w-6 shrink-0 select-none text-white/20">{i + 1}</span>
            {line.map(({ t, c }, j) => (
              <span key={j} className={c}>
                {t}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-1 pb-4">
        {["Bugs", "Security", "Style", "Perf"].map((f) => (
          <span
            key={f}
            className="rounded-md bg-white/[0.06] ring-1 ring-white/10 px-2 py-1 text-[10px] font-semibold text-white/70"
          >
            {f}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-400/10 ring-1 ring-emerald-300/20 px-2 py-1 text-[9.5px] font-semibold text-emerald-300">
          <Check size={9} strokeWidth={3} />
          Fix included
        </span>
      </div>
    </MockWindow>
  );
}
