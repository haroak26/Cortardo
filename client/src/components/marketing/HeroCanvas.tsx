import { useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import {
  MousePointer2,
  ChevronRight,
  ChevronDown,
  GitPullRequest,
  Square,
  Type,
  Image as ImageIcon,
  Layers as LayersIcon,
  Component,
} from "lucide-react";

/*
 * HeroCanvas — a hand-built, high-fidelity mock of the Cortardo review dashboard.
 * Rendered entirely from divs/SVG so it stays crisp at any DPI. It straddles
 * the dark hero → light page seam and shows: files panel, diff views with two
 * real-looking code blocks, findings panel, drifting collaborator cursors,
 * and a floating prompt chip that types review prompts and "applies" them by
 * switching the code accent colour.
 */

const PROMPTS = [
  "Flag the N+1 query in this PR…",
  "Check the auth middleware for races…",
  "Suggest a fix for the null deref…",
];

/* Each prompt maps to an accent the diff "adopts" — a single-hue brand ramp. */
const ACCENTS = ["#284B63", "#4A7A96", "#1A3346"];

type Cursor = { name: string; color: string; className: string; style: React.CSSProperties };

const CURSORS: Cursor[] = [
  {
    name: "Ava",
    color: "#f0abfc",
    className: "cursor-drift-1",
    style: { left: "56%", top: "30%" },
  },
  {
    name: "Liam",
    color: "#7dd3fc",
    className: "cursor-drift-2",
    style: { left: "22%", top: "62%" },
  },
];

function CursorTag({ cursor }: { cursor: Cursor }) {
  return (
    <div className={`absolute z-20 ${cursor.className}`} style={cursor.style}>
      <MousePointer2 size={14} className="drop-shadow-sm" fill={cursor.color} color={cursor.color} />
      <span
        className="ml-3 -mt-1 absolute whitespace-nowrap text-[10px] font-semibold px-1.5 py-0.5 rounded-md rounded-tl-sm text-black/80"
        style={{ background: cursor.color }}
      >
        {cursor.name}
      </span>
    </div>
  );
}

/* ── Mini diff: a believable pull-request file view ── */
function Artboard({ accent, selected }: { accent: string; selected?: boolean }) {
  return (
    <div className="relative w-[168px] md:w-[196px] shrink-0 rounded-lg bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.25)] ring-1 ring-black/[0.06]">
      {selected && (
        <>
          <div className="pointer-events-none absolute -inset-[3px] rounded-[10px] border-[1.5px] border-[#284B63]" />
          {/* Selection handles */}
          {[
            "-top-[5px] -left-[5px]",
            "-top-[5px] left-1/2 -translate-x-1/2",
            "-top-[5px] -right-[5px]",
            "top-1/2 -left-[5px] -translate-y-1/2",
            "top-1/2 -right-[5px] -translate-y-1/2",
            "-bottom-[5px] -left-[5px]",
            "-bottom-[5px] left-1/2 -translate-x-1/2",
            "-bottom-[5px] -right-[5px]",
          ].map((pos) => (
            <span
              key={pos}
              className={`absolute ${pos} w-[7px] h-[7px] rounded-[2px] bg-white border-[1.5px] border-[#284B63] z-10`}
            />
          ))}
          <span className="absolute -top-[22px] left-0 text-[10px] font-semibold text-[#284B63] bg-white px-1 rounded-sm">
            auth.ts · +42 −6
          </span>
        </>
      )}
      {/* Mini nav */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: accent }} />
          <span className="h-1.5 w-8 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-1 w-4 rounded-full bg-slate-200" />
          <span className="h-1 w-4 rounded-full bg-slate-200" />
          <span className="h-3 w-8 rounded-full" style={{ background: accent }} />
        </div>
      </div>
      {/* Mini diff lines */}
      <div className="px-3 pt-2 pb-3 font-mono">
        <div className="h-[7px] w-11/12 rounded-full bg-slate-800" />
        <div className="h-[7px] w-3/4 rounded-full bg-slate-800 mt-1.5" />
        <div className="h-1 w-full rounded-full bg-emerald-200 mt-2.5" />
        <div className="h-1 w-5/6 rounded-full bg-rose-200 mt-1" />
        <div className="flex items-center gap-1.5 mt-2.5">
          <span className="h-4 w-12 rounded-[4px]" style={{ background: accent }} />
          <span className="h-4 w-10 rounded-[4px] bg-slate-100 ring-1 ring-slate-200" />
        </div>
        {/* Mini file block */}
        <div className="mt-2.5 h-12 rounded-md bg-gradient-to-br from-slate-100 to-slate-200 ring-1 ring-slate-200/70 flex items-center justify-center">
          <ImageIcon size={12} className="text-slate-300" />
        </div>
      </div>
    </div>
  );
}

/* ── Second file: a findings/stats-style view ── */
function ArtboardAlt() {
  return (
    <div className="relative w-[150px] md:w-[172px] shrink-0 rounded-lg bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.2)] ring-1 ring-black/[0.06] opacity-95">
      <div className="px-3 pt-2.5 pb-1.5 flex items-center justify-between">
        <span className="h-1.5 w-10 rounded-full bg-slate-300" />
        <span className="h-1 w-6 rounded-full bg-slate-200" />
      </div>
      <div className="px-3 pb-3">
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { v: "2 bugs", bg: "bg-rose-50", bar: "bg-rose-400" },
            { v: "4 style", bg: "bg-amber-50", bar: "bg-amber-400" },
          ].map((s, i) => (
            <div key={i} className={`rounded-md ${s.bg} p-1.5`}>
              <div className="text-[9px] font-bold text-slate-700 leading-none">{s.v}</div>
              <div className="mt-1 h-1 rounded-full bg-white/70 overflow-hidden">
                <div className={`h-full w-2/3 rounded-full ${s.bar}`} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-1.5 rounded-md ring-1 ring-slate-200/80 p-1.5 flex items-end gap-[3px] h-12">
          {[38, 55, 30, 70, 48, 82, 60, 90, 44, 66].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-sm bg-slate-200"
              style={{ height: `${h}%`, backgroundColor: i % 3 === 1 ? "#cfdde6" : undefined }}
            />
          ))}
        </div>
        <div className="mt-1.5 space-y-1">
          <div className="h-1 w-full rounded-full bg-slate-100" />
          <div className="h-1 w-4/5 rounded-full bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

export function HeroCanvas() {
  const reduce = useReducedMotion();
  const [promptIdx, setPromptIdx] = useState(0);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<"type" | "pause" | "wipe">("type");

  /* Cycle prompts; accent changes when a prompt finishes typing. */
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const current = PROMPTS[promptIdx];
    if (phase === "type") {
      if (typed < current.length) {
        t = setTimeout(() => setTyped((v) => v + 1), 34);
      } else {
        t = setTimeout(() => setPhase("wipe"), 2200);
      }
    } else if (phase === "pause") {
      t = setTimeout(() => setPhase("wipe"), 100);
    } else {
      if (typed > 0) {
        t = setTimeout(() => setTyped((v) => v - 1), 10);
      } else {
        setPromptIdx((i) => (i + 1) % PROMPTS.length);
        setPhase("type");
      }
    }
    return () => clearTimeout(t);
  }, [phase, typed, promptIdx, reduce]);

  /* Accent flips as soon as the current prompt finishes typing. */
  const accent = useMemo(() => {
    if (reduce) return ACCENTS[0];
    return phase !== "type" || typed >= PROMPTS[promptIdx].length
      ? ACCENTS[promptIdx]
      : ACCENTS[(promptIdx - 1 + ACCENTS.length) % ACCENTS.length];
  }, [phase, typed, promptIdx, reduce]);

  return (
    <div className="relative mx-auto w-full max-w-[1060px] px-4 md:px-8">
      {/* Perspective wrapper */}
      <div className="[perspective:1600px]">
        <div
          className="relative rounded-xl overflow-hidden ring-1 ring-white/10 shadow-[0_40px_120px_-24px_rgba(2,6,23,0.65),0_0_0_1px_rgba(255,255,255,0.04)] [transform:rotateX(3deg)]"
          style={{ background: "#10131b" }}
        >
          {/* Window chrome */}
          <div className="flex items-center gap-2 h-9 px-3.5 border-b border-white/[0.07] bg-white/[0.03]">
            <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
            <span className="mx-auto flex items-center gap-1.5 text-[11px] font-medium text-white/40">
              <GitPullRequest size={11} />
              app.cortardo.com/reviews/checkout-service
            </span>
            <span className="flex items-center gap-1 text-[10.5px] font-medium text-emerald-300/90">
              <span className="live-blink h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Live
            </span>
          </div>

          <div className="flex h-[300px] sm:h-[360px] md:h-[420px]">
            {/* Layers panel */}
            <div className="hidden md:flex w-[168px] shrink-0 flex-col border-r border-white/[0.06] bg-white/[0.02]">
              <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                Layers
              </div>
              <div className="flex-1 px-1.5 space-y-px text-[11px] text-white/60">
                {[
                  { icon: ChevronDown, label: "checkout-service", depth: 0, caret: true, bold: true },
                  { icon: Square, label: "auth.ts · +42 −6", depth: 1, active: true },
                  { icon: Type, label: "session.ts · +18 −3", depth: 2 },
                  { icon: Type, label: "tokens.ts · +64 −0", depth: 2 },
                  { icon: Square, label: "billing.ts · +31 −9", depth: 2 },
                  { icon: ImageIcon, label: "schema.prisma · +12 −2", depth: 2 },
                  { icon: Square, label: "api.ts · +27 −5", depth: 1 },
                  { icon: Square, label: "tests.e2e.ts · +88 −0", depth: 1 },
                  { icon: Component, label: "12 findings · 3 fixes", depth: 1 },
                ].map(({ icon: Icon, label, depth, caret, bold, active }) => (
                  <div
                    key={label}
                    className={`flex items-center gap-1.5 rounded-md px-1.5 py-[4.5px] cursor-default ${
                      active ? "bg-[#284B63]/25 text-[#9fc3d4]" : "hover:bg-white/[0.04]"
                    }`}
                    style={{ paddingLeft: 6 + depth * 12 }}
                  >
                    {caret ? (
                      <ChevronDown size={11} className="text-white/30" />
                    ) : (
                      <ChevronRight size={11} className="text-transparent" />
                    )}
                    <Icon size={11} className="shrink-0 opacity-70" />
                    <span className={`truncate ${bold ? "font-semibold text-white/80" : ""}`}>{label}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-white/[0.06] px-3 py-2 flex items-center gap-1.5 text-[10.5px] text-white/40">
                <LayersIcon size={11} />
                8 files · 412 changed lines
              </div>
            </div>

            {/* Canvas */}
            <div className="relative flex-1 canvas-dots-dark overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "radial-gradient(rgb(255 255 255 / 0.07) 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                }}
              />
              <div className="relative h-full flex items-center justify-center gap-6 px-4 md:gap-10 overflow-hidden">
                <div className="hidden sm:block -rotate-1">
                  <ArtboardAlt />
                </div>
                <Artboard accent={accent} selected />
                <div className="hidden lg:block rotate-1 opacity-90">
                  {/* A third partial artboard, mostly decorative */}
                  <div className="w-[140px] rounded-lg bg-white shadow-[0_12px_32px_-12px_rgba(15,23,42,0.2)] ring-1 ring-black/[0.06] p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="w-3 h-3 rounded-full" style={{ background: accent }} />
                      <span className="h-1.5 w-12 rounded-full bg-slate-300" />
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 mb-1" />
                    <div className="h-1 w-5/6 rounded-full bg-slate-100 mb-1" />
                    <div className="h-1 w-2/3 rounded-full bg-slate-100 mb-2.5" />
                    <div className="grid grid-cols-3 gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-10 rounded-md bg-slate-100 ring-1 ring-slate-200/70" />
                      ))}
                    </div>
                    <div className="mt-2.5 h-4 w-16 rounded-[4px]" style={{ background: accent }} />
                  </div>
                </div>
              </div>

              {/* Collaborator cursors */}
              {!reduce && CURSORS.map((c) => <CursorTag key={c.name} cursor={c} />)}

              {/* Floating prompt chip */}
              <div className="absolute left-1/2 -translate-x-1/2 bottom-3 md:bottom-4 z-20 w-[min(88%,340px)]">
                <div className="flex items-center gap-2 rounded-full bg-[#151926]/95 backdrop-blur-md ring-1 ring-white/10 pl-3.5 pr-2 py-2 shadow-[0_16px_40px_-8px_rgba(2,6,23,0.7)]">
                  <span
                    className="h-2 w-2 rounded-full shrink-0 transition-colors duration-700"
                    style={{ background: accent }}
                  />
                  <span className="text-[11.5px] md:text-[12px] text-white/85 font-medium truncate">
                    {PROMPTS[promptIdx].slice(0, typed)}
                    <span className="caret-blink text-[#284B63] font-semibold">|</span>
                  </span>
                  <span className="ml-auto shrink-0 h-5 w-5 rounded-full bg-[#284B63] flex items-center justify-center">
                    <MousePointer2 size={10} className="text-white -rotate-45" />
                  </span>
                </div>
              </div>
            </div>

            {/* Findings panel */}
            <div className="hidden xl:flex w-[150px] shrink-0 flex-col border-l border-white/[0.06] bg-white/[0.02]">
              <div className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/30">
                Findings
              </div>
              <div className="px-3 space-y-2.5 text-[11px] text-white/55">
                <div>
                  <div className="mb-1 text-white/35">Severity</div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="h-3.5 w-3.5 rounded-[4px] ring-1 ring-white/20 transition-colors duration-700"
                      style={{ background: accent }}
                    />
                    <span className="font-mono text-[10.5px] text-white/60">high</span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-white/35">Confidence</div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10.5px] text-white/70">92</span>
                    <span className="relative flex-1 h-[3px] rounded-full bg-white/10">
                      <span className="absolute left-[46%] -top-[3.5px] h-[10px] w-[10px] rounded-full bg-[#284B63] ring-2 ring-[#10131b]" />
                    </span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-white/35">Coverage delta</div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10.5px] text-white/70">100</span>
                    <span className="relative flex-1 h-[3px] rounded-full bg-white/10">
                      <span className="absolute right-0 -top-[3.5px] h-[10px] w-[10px] rounded-full bg-white/60 ring-2 ring-[#10131b]" />
                    </span>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-white/35">Suggested fix</div>
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span className="text-white/60">Ready</span>
                    <span className="font-mono text-white/70">1 click</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
