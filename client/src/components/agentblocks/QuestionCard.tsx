import { useState } from "react";
import { Check, ChevronLeft, ChevronRight, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";
import type { CortardoQuestion } from "@shared/schema";
import { cn } from "@/lib/utils";

interface QuestionCardProps {
  questions: CortardoQuestion[];
  answers: Record<string, string>;
  onAnswerChange: (id: string, value: string) => void;
  onSubmit: () => void;
  isLoading?: boolean;
  /** When true the card starts collapsed into a "Questions Answered" bar. */
  collapsed?: boolean;
}

/* Step counter for the footer — a compact "1/4" label with a tiny fill bar
   underneath so you can see where you are in the flow at a glance. */
function ProgressBar({ total, current }: { total: number; current: number }) {
  const pct =
    total > 1
      ? (current / (total - 1)) * 100
      : 100;
  return (
    <span className="flex items-center gap-2">
      <span className="text-[11px] font-semibold tabular-nums text-fg-muted leading-none">
        {current + 1}/{total}
      </span>
      <span className="relative h-[3px] w-12 overflow-hidden rounded-full bg-fg-faint/20">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-brand transition-all duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

/* Soft, flat surface used for every state of the card so it reads as part of
   the agent conversation instead of a floating box. */
const panel = "w-full rounded-[14px] bg-surface-hover p-1.5 flex flex-col";

export function QuestionCard({
  questions,
  answers,
  onAnswerChange,
  onSubmit,
  isLoading,
  collapsed,
}: QuestionCardProps) {
  const [index, setIndex] = useState(0);
  const [otherTouched, setOtherTouched] = useState(false);
  const [expanded, setExpanded] = useState(!collapsed);
  const [reviewing, setReviewing] = useState(false);

  const q = questions[index];
  const isFirst = index === 0;
  const isLast = index === questions.length - 1;
  const current = answers[q.id] ?? "";
  const hasCurrent = current.trim().length > 0;
  const allAnswered = questions.every((qq) => (answers[qq.id] ?? "").trim().length > 0);
  const isOtherValue = current.trim() !== "" && !q.options.some((o) => o.label === current);
  // Show the inline "Other" input either when it was explicitly picked, or when
  // a restored answer is already a custom (non-option) value.
  const showOtherInput = otherTouched || isOtherValue;

  const select = (label: string) => {
    setOtherTouched(false);
    onAnswerChange(q.id, label);
  };

  const goNext = () => {
    if (isLast) {
      if (allAnswered) setReviewing(true);
    } else if (hasCurrent) {
      setIndex((i) => i + 1);
    }
  };
  const goPrev = () => setIndex((i) => Math.max(0, i - 1));

  const editFromOverview = (i: number) => {
    setIndex(i);
    setReviewing(false);
  };

  /* Shared answer-row rendering for the collapsed summary and review step. */
  const answerRow = (qq: CortardoQuestion, i: number, onClick?: () => void) => {
    const answer = (answers[qq.id] ?? "").trim();
    return (
      <button
        key={qq.id}
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left flex items-center justify-between gap-3 rounded-[8px] px-2 py-1 border-none transition-colors cursor-pointer",
          onClick
            ? "bg-transparent hover:bg-background"
            : "bg-background/60 cursor-default",
        )}
      >
        <span className="flex flex-col min-w-0">
          <span className="text-[9.5px] font-semibold uppercase tracking-wider text-fg-muted leading-none">
            {qq.title || "Question"}
          </span>
          <span className="text-[12px] font-medium text-foreground leading-snug truncate mt-0.5">
            {answer || "—"}
          </span>
        </span>
        <span className="shrink-0 flex items-center justify-center w-[14px] h-[14px] rounded-full bg-brand/10">
          <Check size={9} strokeWidth={3} className="text-brand" />
        </span>
      </button>
    );
  };

  const backBtn = `flex items-center justify-center p-0 text-fg-muted hover:text-fg-soft transition-colors border-none bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`;
  const nextBtn = `flex items-center justify-center p-0 text-fg-muted hover:text-fg-soft transition-colors border-none bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`;

  if (!expanded) {
    // Collapsed "done" state: an inline, always-visible list of each question
    // and its chosen answer, with a subtle Edit affordance to reopen the card.
    return (
      <div className="w-full rounded-[14px] bg-surface-hover p-1.5 flex flex-col gap-0.5">
        <div className="flex items-center justify-between px-1.5 pt-0.5 pb-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            Brief answers
          </span>
          <span className="flex items-center gap-1 text-[10px] font-medium text-success">
            <Check size={10} strokeWidth={3} />
            {questions.length} saved
          </span>
        </div>
        {questions.map((qq, i) => answerRow(qq, i))}
        <button
          onClick={() => setExpanded(true)}
          className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-medium text-fg-muted hover:text-foreground transition-colors border-none bg-transparent cursor-pointer py-1 rounded-[8px] hover:bg-background"
        >
          Edit answers
          <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
    );
  }

  // Review / overview step — shown once every question has been answered.
  if (reviewing) {
    return (
      <div className={cn(panel, "gap-1.5")}>
        <div className="pt-0.5">
          <p className="text-[13px] font-semibold text-foreground leading-snug">
            Review your {questions.length} answers
          </p>
          <p className="text-[11px] text-fg-muted mt-0.5">
            Check everything looks right, then confirm to start the review.
          </p>
        </div>
        <div className="flex flex-col gap-0.5">
          {questions.map((qq, i) => answerRow(qq, i, () => editFromOverview(i)))}
        </div>
        <div className="flex items-center justify-between pt-0.5">
          <button
            onClick={() => setReviewing(false)}
            className={backBtn}
          >
            <ChevronLeft size={13} strokeWidth={2} />
            Back
          </button>
          <button
            onClick={() => {
              setReviewing(false);
              onSubmit();
            }}
            disabled={isLoading}
            className={nextBtn}
          >
            Confirm
            <ArrowRight size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(panel, "gap-1.5")}>
      {/* Title above the options for this question */}
      <div className="px-1.5 pt-1.5 pb-1">
        <p className="text-[13px] font-medium text-foreground leading-snug">
          {q.title || q.question}
        </p>
      </div>

      <div className="h-px bg-border/50 mx-1" />

      {/* Options — quiet chips that highlight with a brand ring when picked */}
      <div className="flex flex-col gap-1">
        {q.options.map((opt) => {
          const selected = current === opt.label;
          return (
            <button
              key={opt.label}
              onClick={() => select(opt.label)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-[9px] px-2.5 py-1.5 pr-1.5 text-left transition-colors cursor-pointer",
                selected
                  ? "bg-background"
                  : "bg-background hover:bg-surface-deep",
              )}
            >
              <span className="flex flex-col min-w-0">
                <span
                  className={cn(
                    "text-[12px] font-medium leading-snug",
                    selected ? "text-foreground" : "text-fg-soft",
                  )}
                >
                  {opt.label}
                </span>
                {opt.description && (
                  <span className="text-[10.5px] text-fg-muted mt-0.5 leading-snug">
                    {opt.description}
                  </span>
                )}
              </span>
              <span
                className={cn(
                  "shrink-0 flex items-center justify-center w-[14px] h-[14px] rounded-full transition-colors",
                  selected ? "bg-brand" : "bg-background",
                )}
              >
                {selected && <span className="w-[6px] h-[6px] rounded-full bg-white" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-px bg-border/50 mx-1" />

      {/* "Other" option — when picked it becomes an inline text input. */}
      <div className="flex flex-col gap-1">
        {showOtherInput ? (
          <div className="flex w-full items-center gap-3 rounded-[9px] bg-background px-2.5 py-1.5">
            <input
              autoFocus
              type="text"
              value={current}
              onChange={(e) => onAnswerChange(q.id, e.target.value)}
              placeholder="Type your own answer…"
              className="flex-1 min-w-0 w-0 bg-transparent text-[12px] font-medium text-foreground placeholder:text-fg-faint outline-none p-0 m-0 border-none overflow-hidden"
            />
          </div>
        ) : (
          <button
            onClick={() => {
              setOtherTouched(true);
              onAnswerChange(q.id, "");
            }}
            className="flex w-full items-center gap-3 rounded-[9px] bg-background px-2.5 py-1.5 text-left transition-colors cursor-pointer text-fg-soft hover:bg-surface-deep hover:text-foreground"
          >
            <span className="text-[12px] font-medium">Other</span>
          </button>
        )}
      </div>

      {/* Footer: step counter + back / next */}
      <div className="flex items-center justify-between pt-1.5 pb-0.5">
        <ProgressBar total={questions.length} current={index} />
        <div className="flex items-center gap-1.5">
          <button
            onClick={goPrev}
            disabled={isFirst}
            aria-label="Previous question"
            className="flex items-center justify-center w-6 h-6 rounded-full text-fg-muted hover:text-fg-soft hover:bg-background transition-colors border-none bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} strokeWidth={2} />
          </button>
          <button
            onClick={goNext}
            disabled={isLast ? !allAnswered || isLoading : !hasCurrent}
            aria-label="Next question"
            className="flex items-center justify-center w-6 h-6 rounded-full text-fg-muted hover:text-fg-soft hover:bg-background transition-colors border-none bg-transparent cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={14} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
