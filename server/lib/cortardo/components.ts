import fs from "node:fs";
import path from "node:path";
import type { CortardoBaseComponent, CortardoDesignTokens, EditedComponent } from "@shared/schema";
import { completeJSON, streamText } from "./gateway";

/** Where the base component implementations live (shadcn preset "b0"). */
const BASE_COMPONENTS_DIR = path.resolve(process.cwd(), "client/src/components/base");

/**
 * Registry of the agent's base components — the shadcn "preset b0" (base-nova
 * style) components shipped in client/src/components/base. The agent never
 * invents component names; it can only pick from this registry, which is what
 * the next stage of the pipeline (assembling the UI from base components)
 * consumes.
 */
export interface BaseComponentDef {
  id: string;
  name: string;
  description: string;
  category: "layout" | "navigation" | "form" | "overlay" | "feedback" | "data" | "content";
}

export const BASE_COMPONENT_REGISTRY: BaseComponentDef[] = [
  { id: "accordion", name: "Accordion", description: "Stacked collapsible sections for FAQs and grouped content", category: "content" },
  { id: "alert", name: "Alert", description: "Inline contextual feedback messages (success, info, warning, error)", category: "feedback" },
  { id: "alert-dialog", name: "Alert Dialog", description: "Modal dialog for confirmations and destructive actions", category: "overlay" },
  { id: "avatar", name: "Avatar", description: "User/profile images with fallback initials and group stacking", category: "content" },
  { id: "badge", name: "Badge", description: "Small status/category labels (e.g. plan tier, version, tag)", category: "content" },
  { id: "breadcrumb", name: "Breadcrumb", description: "Hierarchical navigation trail for deep pages", category: "navigation" },
  { id: "button", name: "Button", description: "Primary action trigger with variants and sizes", category: "form" },
  { id: "button-group", name: "Button Group", description: "Grouped, segmented set of related actions", category: "form" },
  { id: "calendar", name: "Calendar", description: "Date picker calendar grid", category: "form" },
  { id: "card", name: "Card", description: "Contained surface for grouping related content", category: "layout" },
  { id: "checkbox", name: "Checkbox", description: "Multi-select boolean control", category: "form" },
  { id: "collapsible", name: "Collapsible", description: "Expand/collapse region for secondary content", category: "content" },
  { id: "command", name: "Command", description: "Cmd-k style command palette with search", category: "overlay" },
  { id: "context-menu", name: "Context Menu", description: "Right-click action menu", category: "overlay" },
  { id: "dialog", name: "Dialog", description: "Modal window for focused tasks", category: "overlay" },
  { id: "drawer", name: "Drawer", description: "Slide-in panel (mobile-friendly modal)", category: "overlay" },
  { id: "dropdown-menu", name: "Dropdown Menu", description: "Menu of actions triggered by a button", category: "navigation" },
  { id: "hover-card", name: "Hover Card", description: "Preview card shown on hover", category: "overlay" },
  { id: "input", name: "Input", description: "Single-line text field", category: "form" },
  { id: "input-group", name: "Input Group", description: "Input with addons/prefix-suffix adornments", category: "form" },
  { id: "label", name: "Label", description: "Form field label with focus association", category: "form" },
  { id: "pagination", name: "Pagination", description: "Page navigation controls for lists/tables", category: "navigation" },
  { id: "popover", name: "Popover", description: "Floating card anchored to a trigger", category: "overlay" },
  { id: "progress", name: "Progress", description: "Determinate progress bar", category: "feedback" },
  { id: "radio-group", name: "Radio Group", description: "Single-select option list", category: "form" },
  { id: "resizable", name: "Resizable", description: "Draggable split panes", category: "layout" },
  { id: "scroll-area", name: "Scroll Area", description: "Custom scrollable region", category: "layout" },
  { id: "select", name: "Select", description: "Dropdown option picker", category: "form" },
  { id: "separator", name: "Separator", description: "Horizontal/vertical divider", category: "content" },
  { id: "sheet", name: "Sheet", description: "Side panel that slides in from an edge", category: "overlay" },
  { id: "skeleton", name: "Skeleton", description: "Loading placeholder blocks", category: "feedback" },
  { id: "slider", name: "Slider", description: "Draggable range input", category: "form" },
  { id: "sonner", name: "Sonner", description: "Toast notifications", category: "feedback" },
  { id: "switch", name: "Switch", description: "On/off toggle control", category: "form" },
  { id: "table", name: "Table", description: "Tabular data display", category: "data" },
  { id: "tabs", name: "Tabs", description: "Tabbed content switcher", category: "navigation" },
  { id: "textarea", name: "Textarea", description: "Multi-line text input", category: "form" },
  { id: "toggle", name: "Toggle", description: "On/off press button (single)", category: "form" },
  { id: "toggle-group", name: "Toggle Group", description: "Grouped multi/single-toggle buttons", category: "form" },
  { id: "tooltip", name: "Tooltip", description: "Short helper hint on hover/focus", category: "feedback" },
];

const SELECT_COMPONENTS_SYSTEM = `You are Cortardo, a code review agent. You are assembling the review workspace for the code the user described.

Your job: choose the BASE COMPONENTS this review workspace's panels need from the provided registry. This is the component-selection stage of the review build — after the review rules and plan are set, you pick the exact building blocks the workspace UI will be made from.

Rules:
- Pick 6 to 14 components from the registry list below. Only use ids that exist in the list.
- Cover the core interaction surfaces implied by the prompt (navigation, forms, lists, modals, feedback), but do not pad the list — every pick should have a real job.
- Prefer "button", "input", "label", "card", "separator", "avatar" for almost any workspace; add overlays (dialog/sheet/popover) only when the workspace clearly needs them.
- "sonner" and "tooltip" should be included only when useful.
- For each pick give a very short reason (under 10 words) tied to the review workspace's actual need.

Respond ONLY with JSON in this shape:
{
  "components": [
    { "id": "button", "reason": "Accept or reject suggested fixes inline" }
  ]
}`;

const FALLBACK_COMPONENT_IDS = ["button", "input", "label", "card", "separator", "avatar", "badge"];

function byId(id: string): BaseComponentDef | undefined {
  return BASE_COMPONENT_REGISTRY.find((c) => c.id === id);
}

/**
 * The component-selection stage: given the user's prompt, the design plan and
 * the design tokens, pick the base components the build will use. Always
 * returns a valid subset of the registry (falls back to a sensible default
 * set if the model misbehaves).
 */
export async function selectBaseComponents(
  prompt: string,
  plan?: string,
  designTokens?: CortardoDesignTokens | null,
): Promise<CortardoBaseComponent[]> {
  const registryText = BASE_COMPONENT_REGISTRY.map((c) => `- ${c.id}: ${c.name} — ${c.description}`).join("\n");
  const context = [
    prompt,
    plan ? `Plan: ${plan}` : "",
    designTokens
      ? `Design tokens — colours: ${Object.values(designTokens.colours ?? {}).slice(0, 5).join(", ")}; fonts: ${Object.values(designTokens.fonts ?? {}).slice(0, 3).join(", ")}; radii: ${Object.values(designTokens.radii ?? {}).slice(0, 4).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const result = await completeJSON<{ components?: Array<{ id?: string; reason?: string }> }>(
      [
        { role: "system", content: `${SELECT_COMPONENTS_SYSTEM}\n\nRegistry:\n${registryText}` },
        { role: "user", content: context },
      ],
      { maxTokens: 2500, temperature: 0.4 },
    );
    const picks = Array.isArray(result?.components) ? result.components : [];
    const unique: CortardoBaseComponent[] = [];
    for (const pick of picks) {
      const def = byId(String(pick?.id ?? "").trim().toLowerCase());
      if (!def) continue;
      if (unique.some((c) => c.id === def.id)) continue;
      unique.push({
        id: def.id,
        name: def.name,
        reason: typeof pick.reason === "string" && pick.reason.trim() ? pick.reason.trim().slice(0, 120) : undefined,
      });
      if (unique.length >= 14) break;
    }
    if (unique.length > 0) return unique;
  } catch (err) {
    console.error("[cortardo-agent] component selection failed:", err);
  }
  return FALLBACK_COMPONENT_IDS.map((id) => {
    const def = byId(id)!;
    return { id: def.id, name: def.name };
  });
}

/** Reads the base implementation (.tsx) of a registry component. */
export function readBaseComponentSource(id: string): string {
  try {
    return fs.readFileSync(path.join(BASE_COMPONENTS_DIR, `${id}.tsx`), "utf8");
  } catch {
    return "";
  }
}

const EDIT_COMPONENT_SYSTEM = `You are Cortardo's component builder. You are given a BASE COMPONENT (a shadcn "preset b0" style component) plus the product's design tokens and design plan. Rewrite the component's single-file implementation so it is customised to that exact product.

Requirements:
- Output ONLY the complete updated .tsx file. No markdown fences, no "Here is...", no commentary outside the file.
- Keep the component's public API (name, exports, props) intact so callers keep working.
- Keep every import that the base file uses (they are all available in the project). You may ADD imports only from the same packages the file already imports.
- Restyle the component to the design tokens: use the token colour values for primary/secondary/accent backgrounds, borders and text; apply the token fonts for heading/body text; apply the token radii for rounded corners. Where the base file uses semantic classes like bg-primary, bg-muted, text-muted-foreground, border-border, rounded-lg, etc., replace them with classes/inline styles that express the token values directly (you may inline hex colours via style={{ ... }} where needed).
- Tailor any presentational copy or structure to the product described in the user prompt and plan (e.g. a nav's brand, placeholder text, aria-labels) without inventing data or imports.
- Keep the file TypeScript-valid and dependency-free beyond what is imported.`;

function tokensSummary(tokens?: CortardoDesignTokens | null): string {
  if (!tokens) return "No design tokens provided — keep the component's existing look.";
  const parts: string[] = [];
  if (tokens.colours) parts.push(`Colours: ${Object.entries(tokens.colours).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (tokens.fonts) parts.push(`Fonts: ${Object.entries(tokens.fonts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (tokens.radii) parts.push(`Radii: ${Object.entries(tokens.radii).map(([k, v]) => `${k}=${v}px`).join(", ")}`);
  if (tokens.sizes) parts.push(`Type sizes: ${Object.entries(tokens.sizes).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  return parts.join("\n");
}

/**
 * Stage 4 — the parallel component-edit agents. One agent per selected base
 * component rewrites it against the design tokens + plan. The edited source
 * streams out token-by-token so the UI can reveal the build live, and the
 * fully-assembled file is returned when done.
 */
export async function* streamEditComponent(opts: {
  component: CortardoBaseComponent;
  prompt: string;
  plan: string;
  tokens: CortardoDesignTokens | null;
}): AsyncGenerator<
  | { type: "start" }
  | { type: "delta"; delta: string }
  | { type: "done"; source: string }
> {
  const { component, prompt, plan, tokens } = opts;
  const baseSource = readBaseComponentSource(component.id);
  yield { type: "start" };

  const user = [
    `Product brief: ${prompt}`,
    plan ? `Design plan: ${plan}` : "",
    tokensSummary(tokens),
    `Base component source (${component.id}.tsx):`,
    "```tsx",
    baseSource || "// (base source unavailable — rebuild a sensible component)",
    "```",
  ]
    .filter(Boolean)
    .join("\n\n");

  const chunks: string[] = [];
  for await (const delta of streamText(
    [
      { role: "system", content: EDIT_COMPONENT_SYSTEM },
      { role: "user", content: user },
    ],
    { maxTokens: 4000, temperature: 0.4 },
  )) {
    if (!delta) continue;
    chunks.push(delta);
    yield { type: "delta", delta };
  }

  const raw = chunks.join("").trim();
  const source = raw
    .replace(/^```(?:tsx|jsx|ts)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  if (!source) throw new Error(`Component edit produced no source for "${component.id}"`);
  yield { type: "done", source };
}

/** Convenience wrapper: run the edit to completion and return the result. */
export async function editComponent(opts: Parameters<typeof streamEditComponent>[0]): Promise<EditedComponent> {
  const { component } = opts;
  try {
    let source = "";
    for await (const step of streamEditComponent(opts)) {
      if (step.type === "done") source = step.source;
    }
    return { id: component.id, name: component.name, source };
  } catch (err) {
    return { id: component.id, name: component.name, source: "", error: (err as Error)?.message || "Component edit failed" };
  }
}