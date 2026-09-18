import type { SupportObservation } from "@shared/support";

/**
 * Browser-side tools for the Support Agent. The model never touches the DOM
 * directly: it receives short ref ids from `inspect_page`, and every action is
 * executed here with a visible highlight so the user can follow along.
 */

export interface SupportAction {
  tool: string;
  args: Record<string, unknown>;
}

export interface SupportToolContext {
  navigate: (path: string) => void;
  /** Active workspace, required by the backend action tools. */
  workspaceId?: string | null;
}

const HIGHLIGHT_STYLE = {
  outline: "2px solid hsl(204 42% 40%)",
  outlineOffset: "2px",
  borderRadius: "8px",
  transition: "outline-color 200ms ease",
} as const;

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "[role=button]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=option]",
  "[role=switch]",
  "[role=checkbox]",
  "[role=radio]",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const MAX_ELEMENTS = 90;
const MAX_DETAIL = 6_000;

const refElements = new Map<string, HTMLElement>();
let refCounter = 0;

function isVisible(el: Element): boolean {
  const node = el as HTMLElement;
  if (!node.isConnected) return false;
  if (node.closest("[data-support-agent]")) return false;
  if (node.closest("[aria-hidden='true'], [hidden], [inert]")) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 1 && rect.height > 1;
}

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function labelFor(el: Element): string {
  const node = el as HTMLElement;
  const aria = node.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (label) return label;
  }
  const placeholder = (node as HTMLInputElement).placeholder?.trim();
  if (placeholder) return placeholder;
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
    const label = node.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim();
    if (label) return label;
    const name = node.getAttribute("name")?.trim();
    if (name) return name;
  }
  const title = node.getAttribute("title")?.trim();
  if (title) return title;
  const text = textOf(el);
  if (text) return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  const alt = node.querySelector("img[alt]")?.getAttribute("alt")?.trim();
  return alt ?? "";
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute("type");
  const role = el.getAttribute("role");
  const kind = role ? `${tag}[${role}]` : type ? `${tag}[${type}]` : tag;
  const label = labelFor(el);
  const extras: string[] = [];
  if ((el as HTMLInputElement).disabled) extras.push("disabled");
  if ((el as HTMLInputElement).checked) extras.push("checked");
  if (el instanceof HTMLSelectElement && el.value) extras.push(`value="${el.value}"`);
  return `${kind}${label ? ` "${label}"` : ""}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

/** Re-scan the page and mint fresh refs. Older refs stop resolving. */
export function inspectPage(): { detail: string; count: number } {
  refElements.clear();
  refCounter = 0;
  const lines: string[] = [];
  const all = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR));
  for (const el of all) {
    if (refElements.size >= MAX_ELEMENTS) break;
    if (!isVisible(el)) continue;
    const parentInteractive = el.parentElement?.closest(INTERACTIVE_SELECTOR);
    const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
    if (parentInteractive && !isField) continue;
    refCounter += 1;
    const ref = `e${refCounter}`;
    refElements.set(ref, el as HTMLElement);
    lines.push(`${ref}  ${describeElement(el)}`);
  }
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .filter(isVisible)
    .slice(0, 8)
    .map((heading) => `${heading.tagName.toLowerCase()}: ${textOf(heading)}`)
    .filter((line) => line.length > 4);
  const detail = [
    headings.length ? `Headings:\n${headings.join("\n")}` : "",
    lines.length ? `Interactive elements (${lines.length}):\n${lines.join("\n")}` : "No interactive elements found.",
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_DETAIL);
  return { detail, count: lines.length };
}

/**
 * Snapshot for the start of a user turn: element refs plus a short text
 * digest. Sent to the model so it understands the page before acting.
 */
export function capturePageSnapshot(): {
  path: string;
  title: string;
  elements: string;
  text: string;
  count: number;
} {
  const { detail, count } = inspectPage();
  return {
    path: `${window.location.pathname}${window.location.search}`,
    title: document.title,
    elements: detail,
    text: readPageText().slice(0, 3_500),
    count,
  };
}

export function readPageText(): string {
  const main = document.querySelector("main") ?? document.body;
  const text = ((main as HTMLElement).innerText ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_DETAIL);
}

function resolveRef(ref: unknown): HTMLElement | null {
  if (typeof ref !== "string") return null;
  const el = refElements.get(ref);
  if (!el || !el.isConnected) return null;
  return el;
}

function highlight(el: HTMLElement, ms = 1_400): void {
  const previous = el.getAttribute("style") ?? "";
  Object.assign(el.style, HIGHLIGHT_STYLE);
  window.setTimeout(() => {
    el.setAttribute("style", previous);
  }, ms);
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function pressEnter(el: HTMLElement): void {
  const options = { key: "Enter", code: "Enter", bubbles: true, cancelable: true } as const;
  el.dispatchEvent(new KeyboardEvent("keydown", options));
  el.dispatchEvent(new KeyboardEvent("keypress", options));
  el.dispatchEvent(new KeyboardEvent("keyup", options));
}

function findByText(text: string): HTMLElement | null {
  const target = text.toLowerCase();
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>('button, a, li, [role=option], [role=menuitem], [role=tab], div, span, p'),
  ).filter((el) => isVisible(el) && textOf(el));
  const exact = candidates
    .filter((el) => textOf(el).toLowerCase() === target)
    .sort((a, b) => textOf(a).length - textOf(b).length)[0];
  if (exact) return exact.closest<HTMLElement>('button, a, [role=option], [role=menuitem], [role=tab], li') ?? exact;
  const partial = candidates
    .filter((el) => textOf(el).toLowerCase().includes(target))
    .sort((a, b) => textOf(a).length - textOf(b).length)[0];
  return partial?.closest<HTMLElement>('button, a, [role=option], [role=menuitem], [role=tab], li') ?? partial ?? null;
}

interface ApiResult {
  ok: boolean;
  status: number;
  data: Record<string, unknown> | null;
}

async function apiRequest(method: string, path: string, body?: Record<string, unknown>): Promise<ApiResult> {
  const response = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, data };
}

function apiError(result: ApiResult, fallback: string): string {
  const message = typeof result.data?.message === "string" ? result.data.message : fallback;
  return `${message} (HTTP ${result.status})`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function execute(action: SupportAction, ctx: SupportToolContext): Promise<SupportObservation> {
  const args = action.args ?? {};
  switch (action.tool) {
    /* ── Backend actions: create the record through the API instead of
       clicking through the UI form. ── */
    case "create_exclusion": {
      const pattern = optionalString(args.pattern);
      if (!pattern) return { tool: action.tool, ok: false, summary: "pattern is required" };
      if (!ctx.workspaceId) return { tool: action.tool, ok: false, summary: "No workspace is selected" };
      const result = await apiRequest("POST", "/api/bot/exclusions", {
        workspaceId: ctx.workspaceId,
        pattern,
        note: optionalString(args.note) ?? null,
        repositoryId: optionalString(args.repositoryId) ?? null,
      });
      if (!result.ok) return { tool: action.tool, ok: false, summary: apiError(result, "Could not create the exclusion") };
      const created = optionalString(result.data?.pattern) ?? pattern;
      return { tool: action.tool, ok: true, summary: `Created exclusion "${created}" (it appears after the page refreshes)` };
    }
    case "create_rule": {
      const instruction = optionalString(args.instruction);
      if (!instruction) return { tool: action.tool, ok: false, summary: "instruction is required" };
      if (!ctx.workspaceId) return { tool: action.tool, ok: false, summary: "No workspace is selected" };
      const result = await apiRequest("POST", "/api/bot/rules", {
        workspaceId: ctx.workspaceId,
        instruction,
        glob: optionalString(args.glob) ?? null,
        repositoryId: optionalString(args.repositoryId) ?? null,
      });
      if (!result.ok) return { tool: action.tool, ok: false, summary: apiError(result, "Could not create the rule") };
      return { tool: action.tool, ok: true, summary: "Created the rule (it appears after the page refreshes)" };
    }
    case "create_learning": {
      const text = optionalString(args.text);
      if (!text) return { tool: action.tool, ok: false, summary: "text is required" };
      if (!ctx.workspaceId) return { tool: action.tool, ok: false, summary: "No workspace is selected" };
      const result = await apiRequest("POST", "/api/bot/learnings", {
        workspaceId: ctx.workspaceId,
        text,
        repositoryId: optionalString(args.repositoryId) ?? null,
      });
      if (!result.ok) return { tool: action.tool, ok: false, summary: apiError(result, "Could not add the learning") };
      return { tool: action.tool, ok: true, summary: "Added the learning (it appears after the page refreshes)" };
    }
    case "update_bot_settings": {
      if (!ctx.workspaceId) return { tool: action.tool, ok: false, summary: "No workspace is selected" };
      const autonomy = optionalString(args.autonomy);
      const instructions = optionalString(args.instructions);
      if (!autonomy && instructions === undefined) {
        return { tool: action.tool, ok: false, summary: "Provide autonomy and/or instructions" };
      }
      const settings: Record<string, unknown> = {};
      if (autonomy) settings.autonomy = autonomy;
      if (instructions !== undefined) settings.instructions = instructions;
      const result = await apiRequest("PATCH", "/api/bot/settings", { workspaceId: ctx.workspaceId, settings });
      if (!result.ok) return { tool: action.tool, ok: false, summary: apiError(result, "Could not update the bot settings") };
      const parts = [autonomy ? `autonomy → ${autonomy}` : "", instructions !== undefined ? "custom instructions saved" : ""].filter(Boolean);
      return { tool: action.tool, ok: true, summary: `Updated bot settings (${parts.join(", ")})` };
    }
    case "invite_teammate": {
      const email = optionalString(args.email);
      if (!email || !email.includes("@")) return { tool: action.tool, ok: false, summary: "A valid email is required" };
      if (!ctx.workspaceId) return { tool: action.tool, ok: false, summary: "No workspace is selected" };
      const role = optionalString(args.role) ?? "editor";
      if (!["admin", "editor", "viewer"].includes(role)) {
        return { tool: action.tool, ok: false, summary: `"${role}" is not a valid role (admin, editor, viewer)` };
      }
      const result = await apiRequest("POST", `/api/workspaces/${ctx.workspaceId}/members`, { email, role });
      if (!result.ok) return { tool: action.tool, ok: false, summary: apiError(result, "Could not send the invite") };
      return { tool: action.tool, ok: true, summary: `Invited ${email} as ${role}` };
    }
    case "inspect_page": {
      const { detail } = inspectPage();
      return { tool: action.tool, ok: true, summary: "Inspected the page", detail };
    }
    case "get_page_text": {
      const detail = readPageText();
      return { tool: action.tool, ok: true, summary: "Read the page text", detail };
    }
    case "click": {
      const el = resolveRef(args.ref);
      if (!el) return { tool: action.tool, ok: false, summary: "Could not find that element — refs were refreshed" };
      const label = labelFor(el);
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlight(el);
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (el instanceof HTMLAnchorElement && el.getAttribute("href")?.startsWith("/")) {
        ctx.navigate(el.getAttribute("href") as string);
      } else {
        el.click();
      }
      return { tool: action.tool, ok: true, summary: `Clicked "${label || describeElement(el)}"` };
    }
    case "set_field": {
      const el = resolveRef(args.ref);
      if (!el) return { tool: action.tool, ok: false, summary: "Could not find that field — refs were refreshed" };
      const value = typeof args.value === "string" ? args.value : String(args.value ?? "");
      if (
        !(el instanceof HTMLInputElement) &&
        !(el instanceof HTMLTextAreaElement) &&
        !el.isContentEditable
      ) {
        return { tool: action.tool, ok: false, summary: `"${labelFor(el)}" is not a text field` };
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlight(el);
      el.focus();
      if (el.isContentEditable) {
        el.textContent = value;
      } else {
        setNativeValue(el as HTMLInputElement | HTMLTextAreaElement, value);
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (args.submit === true) {
        const form = (el as HTMLInputElement).form;
        if (form) form.requestSubmit();
        else pressEnter(el);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return {
        tool: action.tool,
        ok: true,
        summary: `Typed "${value.slice(0, 60)}" into "${labelFor(el)}"${args.submit === true ? " and pressed Enter" : ""}`,
      };
    }
    case "select_option": {
      const el = resolveRef(args.ref);
      if (!el) return { tool: action.tool, ok: false, summary: "Could not find that dropdown — refs were refreshed" };
      const option = typeof args.option === "string" ? args.option : String(args.option ?? "");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlight(el);
      if (el instanceof HTMLSelectElement) {
        const match = Array.from(el.options).find(
          (entry) => entry.text.trim().toLowerCase() === option.toLowerCase() || entry.value === option,
        );
        if (!match) return { tool: action.tool, ok: false, summary: `"${option}" is not an option in "${labelFor(el)}"` };
        el.value = match.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        return { tool: action.tool, ok: true, summary: `Selected "${match.text.trim()}" in "${labelFor(el)}"` };
      }
      el.click();
      await new Promise((resolve) => setTimeout(resolve, 180));
      const found = findByText(option);
      if (!found) return { tool: action.tool, ok: false, summary: `Opened the dropdown but found no option "${option}"` };
      found.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      return { tool: action.tool, ok: true, summary: `Selected "${option}"` };
    }
    case "navigate": {
      const path = typeof args.path === "string" ? args.path.trim() : "";
      if (!path.startsWith("/") || path.startsWith("//")) {
        return { tool: action.tool, ok: false, summary: "Only in-app paths starting with / can be opened" };
      }
      ctx.navigate(path);
      await new Promise((resolve) => setTimeout(resolve, 320));
      return { tool: action.tool, ok: true, summary: `Opened ${path}` };
    }
    case "scroll_to": {
      const el = resolveRef(args.ref);
      if (!el) return { tool: action.tool, ok: false, summary: "Could not find that element — refs were refreshed" };
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlight(el);
      return { tool: action.tool, ok: true, summary: `Scrolled to "${labelFor(el)}"` };
    }
    case "highlight": {
      const el = resolveRef(args.ref);
      if (!el) return { tool: action.tool, ok: false, summary: "Could not find that element — refs were refreshed" };
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlight(el, 2_600);
      return { tool: action.tool, ok: true, summary: `Highlighted "${labelFor(el)}"` };
    }
    default:
      return { tool: action.tool, ok: false, summary: `Unknown tool "${action.tool}"` };
  }
}

export async function executeSupportAction(
  action: SupportAction,
  ctx: SupportToolContext,
): Promise<SupportObservation> {
  try {
    return await execute(action, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { tool: action.tool, ok: false, summary: `Tool failed: ${message}` };
  }
}
