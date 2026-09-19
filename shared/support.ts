import { z } from "zod";

/**
 * ServiceBot — the in-app assistant that answers questions about the
 * current page and performs work on it through browser-side tools.
 *
 * The model runs on OpenRouter (`z-ai/glm-5.3-flash` by default). The
 * browser owns the tools: the model replies with a JSON envelope describing
 * what to say and which tools to run, the client executes them, feeds the
 * observations back, and repeats until the model reports `done`.
 */

export const SUPPORT_AGENT_MODEL = "z-ai/glm-5.3-flash";
export const SUPPORT_AGENT_LABEL = "GLM 5.3 Flash";
export const SUPPORT_AGENT_PROVIDER = "OpenRouter";
/** Small Mistral model used to gate off-topic prompts before the main model. */
export const SUPPORT_AGENT_GUARD_MODEL = "mistralai/mistral-nemo";
export const SUPPORT_AGENT_MAX_TURNS = 6;
export const SUPPORT_AGENT_MAX_MESSAGES = 60;
export const SUPPORT_AGENT_MAX_CHARS = 48_000;
export const SUPPORT_CHAT_TITLE_MAX = 48;
export const SUPPORT_CHAT_DEFAULT_TITLE = "New chat";

/** Shown when the guard model decides the prompt is off-topic for the app. */
export const SUPPORT_AGENT_BLOCKED_MESSAGE =
  "I'm only able to help with this page and with things you'd like to do inside Cortardo. Ask me about what's on screen, or tell me what you want me to do here and I'll take care of it.";

export type SupportChatRole = "user" | "assistant";

export interface SupportChatMessage {
  role: SupportChatRole;
  content: string;
}

export interface SupportPageContext {
  path: string;
  title: string;
  /** Optional extra hint the client knows about the page (e.g. workspace name). */
  scope?: string;
}

/**
 * A locally captured snapshot of the current page. The client prepends this to
 * every new user turn so the model always understands the page it is on, even
 * before it decides to call a tool.
 */
export function formatPageSnapshot(snapshot: {
  path: string;
  title: string;
  elements: string;
  text: string;
}): string {
  return [
    "[Page snapshot — captured automatically when the user sent this message]",
    `Path: ${snapshot.path || "/"}`,
    snapshot.title ? `Title: ${snapshot.title}` : "",
    snapshot.elements,
    snapshot.text ? `\nVisible text:\n${snapshot.text}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export const supportChatRequestSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(24_000),
      }),
    )
    .min(1)
    .max(SUPPORT_AGENT_MAX_MESSAGES),
  page: z
    .object({
      path: z.string().max(400),
      title: z.string().max(300),
      scope: z.string().max(200).optional(),
    })
    .optional(),
  /** Raw user text for the first request of a turn; checked by the guard model. */
  gate: z.string().min(1).max(4_000).optional(),
});

export type SupportChatRequest = z.infer<typeof supportChatRequestSchema>;

export const supportTitleRequestSchema = z.object({
  message: z.string().min(1).max(2_000),
  reply: z.string().max(4_000).optional(),
});

export type SupportTitleRequest = z.infer<typeof supportTitleRequestSchema>;

/**
 * Small-model gate: decides whether a prompt belongs to the app/page or is
 * general chit-chat that ServiceBot should refuse.
 */
export function buildSupportGuardSystemPrompt(): string {
  return [
    "You are an intent gate for ServiceBot, an in-app assistant inside Cortardo (a code review and repository automation product).",
    "ServiceBot can only: answer questions about the current page or the Cortardo UI, explain app concepts/features/settings, and perform actions inside the app (clicking, typing, navigating, filling forms).",
    "Decide whether the user's message is about the app, its pages, or doing something inside it.",
    "Reply with exactly one word: ALLOW or BLOCK.",
    "- ALLOW: anything about Cortardo, this page, the UI, account/workspace/team/repository/bot settings, or an action to perform in the app.",
    "- BLOCK: unrelated topics such as general knowledge, trivia, math, news, weather, health, coding help outside the app, poems, stories or chit-chat.",
    "When in doubt, ALLOW.",
    "Output only the single word.",
  ].join("\n");
}

export function buildSupportTitlePrompt(message: string, reply?: string): string {
  return [
    "Write a short title for this ServiceBot chat. Use 2 to 5 words, title case, no quotes and no ending punctuation.",
    "Describe the user's request, not the assistant's wording.",
    "",
    `User: ${message.slice(0, 600)}`,
    reply ? `ServiceBot: ${reply.slice(0, 600)}` : "",
    "",
    "Title:",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Cleans a model-proposed title into a safe, short label. */
export function cleanSupportChatTitle(raw: string): string {
  const cleaned = raw
    .replace(/^title:\s*/i, "")
    .replace(/["'`*#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "")
    .trim();
  if (!cleaned) return "";
  return cleaned.length > SUPPORT_CHAT_TITLE_MAX ? `${cleaned.slice(0, SUPPORT_CHAT_TITLE_MAX - 1).trimEnd()}…` : cleaned;
}

export interface SupportToolSpec {
  name: string;
  description: string;
  args: string;
}

/** Tool catalogue shared by the prompt and (loosely) the client executor. */
export const SUPPORT_TOOL_SPECS: SupportToolSpec[] = [
  {
    name: "inspect_page",
    description:
      "List the interactive elements currently on screen with short ref ids, plus headings. Always call this before clicking or typing.",
    args: "{}",
  },
  {
    name: "get_page_text",
    description: "Read the main visible text of the current page when you need details that are not interactive.",
    args: "{}",
  },
  {
    name: "click",
    description: "Click a button, link, tab or menu item by its ref from inspect_page.",
    args: '{ "ref": "e12" }',
  },
  {
    name: "set_field",
    description:
      "Type or replace text in an input, textarea or search box. Set submit=true to press Enter afterwards (searches and forms).",
    args: '{ "ref": "e13", "value": "hello", "submit": false }',
  },
  {
    name: "select_option",
    description: "Choose an option in a native select or a custom dropdown by its visible text.",
    args: '{ "ref": "e14", "option": "Pro" }',
  },
  {
    name: "navigate",
    description: "Navigate the app to another in-app path (for example /bot/configuration or /team/manage).",
    args: '{ "path": "/bot/configuration" }',
  },
  {
    name: "scroll_to",
    description: "Scroll an element into view so the user can see it.",
    args: '{ "ref": "e20" }',
  },
  {
    name: "highlight",
    description: "Briefly outline an element to point the user at it. Use for explanations, not actions.",
    args: '{ "ref": "e20" }',
  },
  {
    name: "create_exclusion",
    description:
      "Create a Cortardo Bot exclusion through the backend API. Prefer this over clicking the Add Exclusion form.",
    args: '{ "pattern": "node_modules/**", "note": "generated code" }',
  },
  {
    name: "create_rule",
    description:
      "Create a Cortardo Bot review rule through the backend API. Prefer this over filling the Add Rule form.",
    args: '{ "instruction": "Always flag TODO comments in production code", "glob": "src/**" }',
  },
  {
    name: "create_learning",
    description: "Add a Cortardo Bot learning (guidance it remembers) through the backend API.",
    args: '{ "text": "This repository uses pnpm, not npm" }',
  },
  {
    name: "update_bot_settings",
    description:
      "Update bot settings through the backend API. Provide autonomy (manual | assisted | autonomous) and/or custom instructions.",
    args: '{ "autonomy": "assisted", "instructions": "Prefer small, focused pull requests." }',
  },
  {
    name: "invite_teammate",
    description:
      "Invite someone to the current workspace through the backend API. Role defaults to editor (admin | editor | viewer).",
    args: '{ "email": "dev@acme.com", "role": "editor" }',
  },
];

const TOOL_LIST = SUPPORT_TOOL_SPECS.map((tool) => `- ${tool.name} — ${tool.description} args: ${tool.args}`).join("\n");

/**
 * The complete system prompt. The client sends the page context with every
 * request, so the model always knows where it is without inspecting the DOM.
 */
export function buildSupportAgentSystemPrompt(page?: SupportPageContext): string {
  const location = page
    ? [
        `Current page: ${page.path}`,
        page.title ? `Page title: ${page.title}` : "",
        page.scope ? `Workspace context: ${page.scope}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "Current page: unknown";

  return `You are ServiceBot inside Cortardo, a code-review and repository automation product. You help the signed-in user understand the page they are on and you can operate the page for them. You are powered by ${SUPPORT_AGENT_LABEL} via ${SUPPORT_AGENT_PROVIDER}.

${location}

## How you reply
Reply with ONE JSON object and nothing else — no markdown fences, no commentary around it:
{"message": "what to tell the user (markdown allowed, may be empty)", "actions": [{"tool": "name", "args": {}}], "done": false}

- "message" is shown to the user immediately.
- "actions" are executed in the browser, in order. Use them whenever the request needs the page to change or needs data from the page.
- Set "done": true only when the user's request is fully handled. If you are waiting for the user (for example to confirm a destructive action), set "done": true and ask in "message".
- If no action is needed, return an empty actions array.

## Tools you can call
${TOOL_LIST}

## Rules
1. Every new user message arrives with a fresh "[Page snapshot]" containing the path, headings, interactive elements and visible text. Read it first — it is your ground truth for what is on screen. Refs in the snapshot expire after any page change; call inspect_page for fresh refs before acting.
2. Inspect before acting unless the request is purely conversational. Never guess a ref or an element's label.
3. Prefer few, precise actions (1-3 per turn). After each turn, read the observations and continue.
4. For creating exclusions, rules or learnings, changing bot settings, or inviting teammates, ALWAYS use the matching backend action tool — never click through the form field by field. Clicking is only for navigation, filters, tabs, dialogs you must inspect, and UI with no action tool.
5. Navigate only to in-app paths that start with "/". Never invent routes; if you are unsure, inspect the sidebar links first.
6. Irreversible or destructive operations (deleting data, removing members, disconnecting integrations, changing billing, signing out) require explicit confirmation: ask in "message", set "done": true, and only act after the user says yes.
7. Never ask for passwords, API keys, payment details or other secrets. If a task needs them, tell the user to enter them themselves.
8. You cannot see other workspaces, other users' private data or anything outside this browser page. Say so plainly instead of pretending.
9. If a tool fails twice, stop retrying: explain what happened and give the user the manual steps.
10. Keep messages short and concrete. Use markdown lists only when they help. Reference UI labels exactly as they appear.
11. If the user only asks a question, answer it from the page context and inspection. Do not perform actions they did not ask for.`;
}

export interface SupportObservation {
  tool: string;
  ok: boolean;
  summary: string;
  detail?: string;
}

/** Observation block fed back to the model after the browser runs the tools. */
export function formatSupportObservations(observations: SupportObservation[]): string {
  if (observations.length === 0) return "No actions were run.";
  const lines = observations.map((entry) => {
    const detail = entry.detail ? `\n    ${entry.detail.replace(/\n/g, "\n    ")}` : "";
    return `- ${entry.ok ? "ok" : "failed"} ${entry.tool}: ${entry.summary}${detail}`;
  });
  return [
    "Observations from your last actions:",
    ...lines,
    "",
    "Continue with the next JSON reply. Call inspect_page if the page changed and you need fresh refs.",
  ].join("\n");
}

/**
 * Parses a model reply into an action envelope. Tolerates code fences and
 * prose around the JSON object. Returns `parsed: false` when the model
 * answered with plain text instead (treated as a final message).
 */
export function parseSupportReply(raw: string): {
  message: string;
  actions: { tool: string; args: Record<string, unknown> }[];
  done: boolean;
  parsed: boolean;
} {
  const text = raw.trim();
  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(text);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as Record<string, unknown>;
      if (!value || typeof value !== "object") continue;
      const message = typeof value.message === "string" ? value.message : "";
      const done = value.done === true;
      const rawActions = Array.isArray(value.actions) ? value.actions : [];
      const actions = rawActions
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const tool = (entry as Record<string, unknown>).tool;
          if (typeof tool !== "string" || tool.length === 0) return null;
          const argsValue = (entry as Record<string, unknown>).args;
          const args =
            argsValue && typeof argsValue === "object" && !Array.isArray(argsValue)
              ? (argsValue as Record<string, unknown>)
              : {};
          return { tool, args };
        })
        .filter((entry): entry is { tool: string; args: Record<string, unknown> } => entry !== null);
      if (message || actions.length > 0 || done || "actions" in value) {
        return { message, actions, done, parsed: true };
      }
    } catch {
      /* try the next candidate */
    }
  }
  return { message: text, actions: [], done: true, parsed: false };
}
