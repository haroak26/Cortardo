import { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { Button, brandIconButtonClass } from '@/components/button';
import { ArrowUp } from 'lucide-react';
import { Alert02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings01Icon, PlusSignIcon, FolderOpenIcon, Cancel01Icon, SparklesIcon, StopIcon, Loading03Icon } from '@hugeicons/core-free-icons';

type Attachment = {
  id: string;
  type: 'image' | 'file' | 'component' | 'asset';
  name: string;
  preview?: string;
};

export type PromptOptions = { model: string; reasoning: string; variations: string };

type Props = {
  onSubmit: (prompt: string, options: PromptOptions) => void;
  isLoading?: boolean;
  placeholder?: string;
  systemError?: boolean;
  initialValue?: string;
  compact?: boolean;
  /** Pre-selected model/reasoning (e.g. restored from a previous screen). */
  initialModel?: string | null;
  initialReasoning?: string | null;
  /** Rotating typewriter examples shown while the input is empty. */
  examples?: string[];
  /** Show the "Review anything..." placeholder when focused and empty (landing page only). */
  showFocusPlaceholder?: boolean;
  /** Dark glass treatment for use on dark hero backgrounds. */
  tone?: "light" | "dark";
  /** Hide the attach + customize controls for fixed-model surfaces (Support Agent). */
  showControls?: boolean;
  /** Single-line pill layout with an inline model chip and circular send button. */
  variant?: "box" | "pill";
  /** Pill only: called when the loading send button is pressed to cancel. */
  onStop?: () => void;
};

export type PromptInputHandle = {
  /** Set the prompt value from outside (e.g. clicking a suggested example). */
  setValue: (v: string) => void;
  /** Type a prompt into the box with the typewriter effect (clears the current example first). */
  typePrompt: (text: string) => void;
};

const MODELS = [
  { value: 'GPT 5.6 Luna', label: 'GPT 5.6 Luna', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" />, desc: 'Best for complex review tasks' },
  { value: 'GPT 5.6 Terra', label: 'GPT 5.6 Terra', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" />, desc: 'Balanced for everyday review work' },
  { value: 'GPT 5.6 Sol', label: 'GPT 5.6 Sol', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" />, desc: 'Fast and efficient for quick iterations' },
  { value: 'Gemini 3.1 Pro', label: 'Gemini 3.1 Pro', icon: <img src="/geminilogo.webp" alt="" className="w-[14px] h-[14px] shrink-0" />, desc: 'Best for multimodal understanding' },
  { value: 'Gemini 3.7 Flash', label: 'Gemini 3.7 Flash', icon: <img src="/geminilogo.webp" alt="" className="w-[14px] h-[14px] shrink-0" />, desc: 'Optimised for speed and quality' },
  { value: 'GLM 5.3 Flash', label: 'GLM 5.3 Flash', icon: <HugeiconsIcon icon={SparklesIcon} size={14} className="shrink-0 text-[hsl(var(--brand-soft))]" />, desc: 'Fast agent model for support and page actions' },
];

const VARIATIONS = ['1 Variation', '2 Variations'] as const;

const GPT_REASONING: { value: string; desc: string }[] = [
  { value: 'Medium', desc: 'Balanced reasoning for most tasks' },
  { value: 'High', desc: 'Deeper reasoning for complex tasks' },
  { value: 'Extra High', desc: 'Extensive reasoning for demanding tasks' },
  { value: 'Max', desc: 'Maximum reasoning effort' },
];

const GEMINI_REASONING: { value: string; desc: string }[] = [
  { value: 'Medium', desc: 'Balanced reasoning for most tasks' },
  { value: 'High', desc: 'Deeper reasoning for complex tasks' },
];

const MODEL_META: Record<string, { label: string; icon: React.ReactNode }> = {
  'GPT 5.6 Luna': { label: 'GPT 5.6 Luna', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" /> },
  'GPT 5.6 Terra': { label: 'GPT 5.6 Terra', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" /> },
  'GPT 5.6 Sol': { label: 'GPT 5.6 Sol', icon: <img src="/chatgptlogo.svg" alt="" className="w-[14px] h-[14px] shrink-0" /> },
  'Gemini 3.1 Pro': { label: 'Gemini 3.1 Pro', icon: <img src="/geminilogo.webp" alt="" className="w-[14px] h-[14px] shrink-0" /> },
  'Gemini 3.7 Flash': { label: 'Gemini 3.7 Flash', icon: <img src="/geminilogo.webp" alt="" className="w-[14px] h-[14px] shrink-0" /> },
  'GLM 5.3 Flash': { label: 'GLM 5.3 Flash', icon: <HugeiconsIcon icon={SparklesIcon} size={14} className="shrink-0 text-[hsl(var(--brand-soft))]" /> },
};

type FlyoutView = 'model' | 'variations' | 'reasoning';

function MenuRow({ label, current, onClick, active = false }: { label: string; current: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft transition-colors border-none bg-transparent cursor-pointer text-left ${
        active ? 'bg-surface-hover' : 'hover:bg-surface-hover'
      }`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1.5 text-fg-faint">
        {current}
      </span>
    </button>
  );
}

export const PromptInput = forwardRef<PromptInputHandle, Props>(
  function PromptInput({ onSubmit, isLoading, placeholder = 'What would you like to review?', systemError, initialValue, compact = false, initialModel, initialReasoning, examples, showFocusPlaceholder = true, tone = 'light', showControls = true, variant = 'box', onStop }, ref) {
  const dark = tone === 'dark';
  const pill = variant === 'pill';
  const [prompt, setPrompt] = useState(initialValue ?? '');
  const [model, setModel] = useState<string>(initialModel ?? MODELS[0].value);
  const [variations, setVariations] = useState<string>(VARIATIONS[0]);
  const [reasoning, setReasoning] = useState<string>(initialReasoning ?? 'Medium');

  const reasoningOptions = model.startsWith('Gemini') ? GEMINI_REASONING : GPT_REASONING;
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [flyoutView, setFlyoutView] = useState<FlyoutView | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [examplePhase, setExamplePhase] = useState<'type' | 'pause' | 'delete'>('type');
  const [typeTarget, setTypeTarget] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const customizeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* Slow typewriter reveal for the rotating example placeholders. */
  useEffect(() => {
    if (systemError) return;
    let t: ReturnType<typeof setTimeout>;
    if (typeTarget) {
      /* Chip-triggered prompt: type the chip prompt right away (no wipe of the current example), faster and in the foreground color. */
      if (focused) {
        setTypeTarget(null);
        setTyped(0);
        setExamplePhase('type');
        return;
      }
      if (examplePhase === 'type') {
        if (typed < typeTarget.length) {
          t = setTimeout(() => setTyped((v) => v + 1), 12);
        } else {
          setPrompt(typeTarget);
          setTypeTarget(null);
          setTyped(0);
          setExamplePhase('type');
          textareaRef.current?.focus();
          return;
        }
      }
      return () => clearTimeout(t);
    }
    if (!examples?.length || prompt) return;
    const current = examples[exampleIndex % examples.length];
    if (focused) {
      /* Focused and empty: quickly wipe the example, then the placeholder takes over. */
      if (typed > 0) {
        if (examplePhase !== 'delete') setExamplePhase('delete');
        t = setTimeout(() => setTyped((v) => v - 1), 8);
      }
      return () => clearTimeout(t);
    }
    if (examplePhase === 'type') {
      if (typed < current.length) {
        t = setTimeout(() => setTyped((v) => v + 1), 42);
      } else {
        t = setTimeout(() => setExamplePhase('pause'), 2400);
      }
    } else if (examplePhase === 'pause') {
      t = setTimeout(() => setExamplePhase('delete'), 2400);
    } else {
      if (typed > 0) {
        t = setTimeout(() => setTyped((v) => v - 1), 16);
      } else {
        setExampleIndex((i) => (i + 1) % examples.length);
        setExamplePhase('type');
        return;
      }
    }
    return () => clearTimeout(t);
  }, [examplePhase, typed, exampleIndex, examples, prompt, focused, systemError, typeTarget]);

  /* Rough row count so the box grows to fit the typed/entered prompt instead of clipping it. */
  const visibleRows = useMemo(() => {
    const text = prompt || (typeTarget ?? '');
    if (!text) return 2;
    return Math.min(6, Math.max(2, Math.ceil(text.length / 58)));
  }, [prompt, typeTarget]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inFlyout = flyoutRef.current?.contains(target);
      if (customizeRef.current && !customizeRef.current.contains(target) && !inFlyout) {
        setCustomizeOpen(false);
        setFlyoutView(null);
      }
    };
    if (customizeOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [customizeOpen, flyoutView]);

  useEffect(() => {
    if (!flyoutView) return;
    const close = () => setFlyoutView(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [flyoutView]);

  useEffect(() => {
    if (!flyoutView || !flyoutPos || !flyoutRef.current) return;
    const width = flyoutRef.current.offsetWidth;
    const vw = window.innerWidth;
    let left = flyoutPos.left;
    if (left + width > vw - 8) {
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (panelRect) left = Math.max(8, panelRect.left - width - 8);
    }
    setFlyoutPos((p) => (p && p.left === left ? p : p ? { ...p, left } : p));
  }, [flyoutView, flyoutPos]);

  const toggleFlyout = (view: FlyoutView) => {
    if (flyoutView === view) {
      setFlyoutView(null);
      return;
    }
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    setFlyoutPos({ top: rect.top, left: rect.right + 8 });
    setFlyoutView(view);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    if (attachOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [attachOpen]);

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;
    setPrompt('');
    onSubmit(trimmed, { model, reasoning, variations });
  }, [prompt, isLoading, onSubmit, model, reasoning, variations]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  useImperativeHandle(ref, () => ({
    setValue: (v: string) => {
      setPrompt(v);
      setTyped(0);
      (inputRef.current ?? textareaRef.current)?.focus();
    },
    typePrompt: (text: string) => {
      setPrompt('');
      setFocused(false);
      setTypeTarget(text);
      setExamplePhase('type');
      setTyped(0);
    },
  }));

  const addAttachment = useCallback((type: Attachment['type']) => {
    const names: Record<string, string> = {
      image: 'Attached image',
      file: 'Attached file',
      component: 'Attached component',
      asset: 'Attached asset',
    };
    const newAttachment: Attachment = {
      id: crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11),
      type,
      name: names[type],
    };
    setAttachments(prev => [...prev, newAttachment]);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
    setAttachOpen(false);
  }, []);

  const handleFilesChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    files.forEach((file) => {
      const id = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 11);
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          setAttachments(prev => [...prev, { id, type: 'image', name: file.name, preview: reader.result as string }]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments(prev => [...prev, { id, type: 'file', name: file.name }]);
      }
    });
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  if (pill) {
    return (
      <div className={`w-full ${dark ? 'prompt-input-dark' : ''}`}>
        {systemError && (
          <div role="alert" className="mb-2 rounded-[10px] bg-[hsl(var(--danger)/0.14)] px-3 py-2 flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-[hsl(var(--danger))]">Something went wrong. Please try again.</p>
            <HugeiconsIcon icon={Alert02Icon} size={13} strokeWidth={2} className="text-[hsl(var(--danger))] shrink-0" />
          </div>
        )}
        <div
          className={`flex items-center gap-1.5 h-[46px] rounded-full pl-4 pr-1.5 ${
            dark
              ? 'bg-white/[0.06] border border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl'
              : 'bg-surface-hover'
          }`}
        >
          <input
            ref={inputRef}
            type="text"
            value={systemError ? '' : prompt}
            onChange={(e) => { if (!systemError) setPrompt(e.target.value); }}
            onKeyDown={systemError ? undefined : handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={placeholder}
            disabled={systemError}
            className={`min-w-0 flex-1 h-[34px] p-0 bg-transparent outline-none border-none text-[13px] leading-[34px] placeholder:text-fg-faint ${dark ? 'text-white/95 placeholder:text-white/30' : 'text-foreground placeholder:text-fg-faint'}`}
          />
          {isLoading && onStop ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-none cursor-pointer transition-colors ${
                dark ? 'bg-white/[0.08] text-white/80 hover:bg-white/[0.14]' : 'bg-surface-deep text-foreground hover:bg-surface-hover-strong'
              }`}
            >
              <HugeiconsIcon icon={StopIcon} size={13} strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!prompt.trim() || isLoading || systemError}
              aria-label="Send"
              className={`${brandIconButtonClass} !h-[34px] !w-[34px] max-md:!h-[34px] max-md:!w-[34px]`}
            >
              {isLoading ? (
                <HugeiconsIcon icon={Loading03Icon} size={15} strokeWidth={2} className="animate-spin" />
              ) : (
                <ArrowUp size={15} />
              )}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-xl mx-auto ${dark ? 'prompt-input-dark' : ''}`}>
        {systemError && (
          <div role="alert" className="mb-2 rounded-[10px] bg-[hsl(var(--danger)/0.14)] px-3 py-2 flex items-center justify-between gap-2">
            <p className="text-[12px] font-medium text-[hsl(var(--danger))]">Something went wrong. Please try again.</p>
            <HugeiconsIcon icon={ Alert02Icon } size={13} strokeWidth={2} className="text-[hsl(var(--danger))] shrink-0"  />
          </div>
        )}
        <div className={`${compact ? 'rounded-[13px]' : 'rounded-[22px]'} ${dark ? 'bg-white/[0.06] border border-white/10 shadow-[0_8px_32px_-8px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl' : 'bg-surface-hover'}`}>
        <div className="relative">
          {attachments.length > 0 && (
            <div className="flex items-center gap-2 px-3 pt-3 flex-wrap">
              {attachments.map((att) => (
                <div key={att.id} className="relative group shrink-0">
                  {att.type === 'image' ? (
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-border bg-surface-muted">
                      <img src={att.preview} alt={att.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-muted border border-border">
                      <HugeiconsIcon icon={ FolderOpenIcon } size={12}  />
                      <span className="text-[11px] font-medium text-fg-muted max-w-[80px] truncate">{att.name}</span>
                    </div>
                  )}
                  <button
                    onClick={() => removeAttachment(att.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground/70 text-background flex items-center justify-center transition-colors border-none cursor-pointer hover:bg-foreground"
                  >
                    <HugeiconsIcon icon={ Cancel01Icon } size={10}  />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={systemError ? '' : prompt}
            onChange={(e) => { if (!systemError) setPrompt(e.target.value); }}
            onKeyDown={systemError ? undefined : handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={systemError ? 'Ask Anything...' : focused && typed === 0 ? (examples?.length ? placeholder : showFocusPlaceholder ? 'Review anything...' : placeholder) : examples?.length ? '' : placeholder}
            rows={visibleRows}
            className={`w-full resize-none bg-transparent outline-none border-none leading-relaxed placeholder:text-fg-faint ${dark ? 'text-white/95 placeholder:text-white/30' : 'text-foreground placeholder:text-fg-faint'} ${compact ? 'text-[13px] pl-3 pr-2.5 pt-2.5 pb-0' : 'text-[14px] pl-4 pr-3 sm:pl-4 sm:pr-3 pt-3 sm:pt-3 pb-0 sm:pb-1'}`}
          />
          {!!examples?.length && !systemError && (
            <div
              aria-hidden
              className={`pointer-events-none absolute left-4 top-3 max-w-[calc(100%-28px)] text-left text-[14px] leading-relaxed transition-opacity duration-300 ${typeTarget ? '' : 'truncate'} ${prompt || (focused && typed === 0) ? 'opacity-0' : 'opacity-100'} ${typeTarget ? (dark ? 'text-white/90' : 'text-foreground') : dark ? 'text-white/35' : 'text-fg-faint'}`}
            >
              {(typeTarget ?? examples[exampleIndex % examples.length]).slice(0, typed)}
            </div>
          )}
        </div>

        <div className={`flex items-end justify-between ${compact ? 'px-2.5 pb-2.5' : 'px-3 pb-3'}`}>
          {!showControls ? (
            <span className="flex items-center gap-1.5 h-[28px] pl-0.5 text-[11px] font-medium text-fg-faint select-none">
              {MODEL_META[model]?.icon}
              {MODEL_META[model]?.label ?? model}
            </span>
          ) : (
          <div className="flex items-center gap-1.5">
            {/* Attach dropdown */}
            <div className="relative" ref={attachRef}>
              <button
                onClick={() => { if (!systemError) setAttachOpen(!attachOpen); }}
                className={`flex items-center justify-center rounded-[8px] transition-colors border-none cursor-pointer ${dark ? 'text-white/80 bg-white/[0.08] hover:bg-white/[0.14]' : 'text-foreground bg-surface-deep'} ${compact ? 'h-[28px] w-[28px]' : 'h-[32px] w-[32px]'}`}
              >
                <HugeiconsIcon icon={ PlusSignIcon } size={compact ? 14 : 16} className={`transition-transform duration-200 ${attachOpen ? 'rotate-45' : ''}`}  />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv"
                className="hidden"
                onChange={handleFilesChosen}
              />
              {!systemError && attachOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAttachOpen(false)} />
                  <div className="absolute left-0 bottom-full mb-1 z-20 min-w-[190px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
                    <button onClick={openFilePicker} className="flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left">
                      File Library
                    </button>
                    <div className="h-px bg-border/60 mx-1.5 my-0.5" />
                    <button onClick={() => { setAttachOpen(false); }} className="flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left">
                      Connect Project
                    </button>
                    <button onClick={() => { addAttachment('component'); setAttachOpen(false); }} className="flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left">
                      Select Components
                    </button>
                    <button onClick={() => { addAttachment('asset'); setAttachOpen(false); }} className="flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-fg-soft hover:bg-surface-hover transition-colors border-none bg-transparent cursor-pointer text-left">
                      Select Assets
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Customize dropdown */}
            <div className="relative" ref={customizeRef}>
              <button
                onClick={() => { if (!systemError) { setCustomizeOpen(!customizeOpen); setFlyoutView(null); } }}
                className={`flex items-center justify-center rounded-[8px] transition-colors border-none cursor-pointer ${dark ? 'text-white/80 bg-white/[0.08] hover:bg-white/[0.14]' : 'text-foreground bg-surface-deep'} ${compact ? 'h-[28px] w-[28px]' : 'h-[32px] w-[32px]'}`}
              >
                <HugeiconsIcon icon={ Settings01Icon } size={compact ? 14 : 16} className={`transition-transform duration-300 ${customizeOpen ? 'rotate-180' : ''}`}  />
              </button>

              {!systemError && customizeOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => { setCustomizeOpen(false); setFlyoutView(null); }} />
                  <div ref={panelRef} className="absolute left-0 bottom-full mb-1 z-20 min-w-[230px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md">
                    <MenuRow label="Model" active={flyoutView === 'model'} current={<span className="flex items-center gap-1.5">{MODEL_META[model]?.label}</span>} onClick={() => toggleFlyout('model')} />
                    <div className="h-px bg-border/60 mx-1.5 my-0.5" />
                    <MenuRow label="Variations" active={flyoutView === 'variations'} current={<>{variations}</>} onClick={() => toggleFlyout('variations')} />
                    <div className="h-px bg-border/60 mx-1.5 my-0.5" />
                    <MenuRow label="Reasoning" active={flyoutView === 'reasoning'} current={<>{reasoning}</>} onClick={() => toggleFlyout('reasoning')} />
                  </div>
                </>
              )}

              {!systemError && customizeOpen && flyoutView && flyoutPos && createPortal(
                <div
                  ref={flyoutRef}
                  className="fixed z-[100] min-w-[200px] bg-background border border-border rounded-[14px] p-1 flex flex-col gap-1 shadow-md"
                  style={{ top: flyoutPos.top, left: flyoutPos.left }}
                >
                  {flyoutView === 'model' && (
                    <>
                      {MODELS.map((m, idx) => (
                        <div key={m.value}>
                          {idx === 3 && <div className="h-px bg-border/60 mx-1.5 my-0.5" />}
                          <button
                            onClick={() => {
                              setModel(m.value);
                              if (m.value.startsWith('Gemini') && !GEMINI_REASONING.some((r) => r.value === reasoning)) {
                                setReasoning('Medium');
                              }
                              setFlyoutView(null);
                            }}
                            className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-left transition-colors border-none cursor-pointer ${
                              m.value === model ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                            }`}
                          >
                            {m.icon}
                            <div>
                              <div className="text-[12.5px] font-medium text-fg-soft">{m.label}</div>
                              <div className="text-[10.5px] text-fg-faint leading-tight mt-0.5">{m.desc}</div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </>
                  )}

                  {flyoutView === 'variations' && (
                    <>
                      {VARIATIONS.map((v) => (
                        <button
                          key={v}
                          onClick={() => { setVariations(v); setFlyoutView(null); }}
                          className={`flex w-full items-center px-2 py-1.5 rounded-[8px] text-[12.5px] font-medium text-left transition-colors border-none cursor-pointer ${
                            v === variations ? 'bg-surface-hover text-fg-soft' : 'text-fg-soft hover:bg-surface-hover'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </>
                  )}

                  {flyoutView === 'reasoning' && (
                    <>
                      {reasoningOptions.map((r) => (
                        <button
                          key={r.value}
                          onClick={() => { setReasoning(r.value); setFlyoutView(null); }}
                          className={`flex w-full items-center gap-2 px-2 py-1.5 rounded-[8px] text-left transition-colors border-none cursor-pointer ${
                            r.value === reasoning ? 'bg-surface-hover' : 'hover:bg-surface-hover'
                          }`}
                        >
                          <div className="flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12.5px] font-medium text-fg-soft">{r.value}</span>
                              {r.value === 'Medium' && (
                                <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-deep text-fg-muted shrink-0">Default</span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-fg-faint leading-tight mt-0.5">{r.desc}</div>
                          </div>
                        </button>
                      ))}
                    </>
                  )}
                </div>,
                document.body
              )}
            </div>
          </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!prompt.trim() || isLoading || systemError}
            isLoading={isLoading}
            size={compact ? "xs" : "sm"}
            className={compact ? "rounded-[8px]" : "rounded-[10px]"}
          >
            <ArrowUp size={compact ? 14 : 18} />
          </Button>
        </div>
      </div>
    </div>
  );
});
PromptInput.displayName = "PromptInput";
