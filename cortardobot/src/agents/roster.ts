import type { CortadoConfig } from "../config";
import type { AgentKind, AgentSpec, PRContext } from "../types";

const BASE_AGENTS: Record<string, AgentSpec> = {
  bug: {
    id: "luna-bug",
    kind: "bug",
    title: "Bug Luna",
    focus: "logic errors, incorrect conditions, boundary mistakes, null/undefined handling",
    priority: 100,
  },
  security: {
    id: "luna-security",
    kind: "security",
    title: "Security Luna",
    focus: "injection, secrets, unsafe deserialization, XSS, auth bypass",
    priority: 98,
  },
  auth: {
    id: "luna-auth",
    kind: "auth",
    title: "Auth Luna",
    focus: "authentication, authorization, session handling, ownership checks",
    priority: 94,
  },
  database: {
    id: "luna-database",
    kind: "database",
    title: "Database Luna",
    focus: "queries, migrations, transactions, data integrity",
    priority: 84,
  },
  api: {
    id: "luna-api",
    kind: "api",
    title: "API Luna",
    focus: "request handling, response contracts, validation, backwards compatibility",
    priority: 80,
  },
  performance: {
    id: "luna-performance",
    kind: "performance",
    title: "Performance Luna",
    focus: "quadratic work, N+1 access, blocking calls, unbounded memory",
    priority: 66,
  },
  ui: {
    id: "luna-ui",
    kind: "ui",
    title: "UI Luna",
    focus: "rendering correctness, unsafe DOM writes, state and event handling",
    priority: 70,
  },
  regression: {
    id: "luna-regression",
    kind: "regression",
    title: "Regression Luna",
    focus: "removed behavior, changed contracts, call sites left behind",
    priority: 76,
  },
  runtime: {
    id: "luna-runtime",
    kind: "runtime",
    title: "Runtime Luna",
    focus: "async errors, unhandled rejections, resource leaks, startup failures",
    priority: 72,
  },
  config: {
    id: "luna-config",
    kind: "config",
    title: "Config Luna",
    focus: "environment variables, insecure defaults, build and CI configuration",
    priority: 62,
  },
};

const CLASSIFICATION_AGENTS: Record<string, AgentKind[]> = {
  AUTH: ["auth", "security"],
  API: ["api"],
  DATABASE: ["database"],
  UI: ["ui", "runtime"],
  PERFORMANCE: ["performance"],
  CONFIG: ["config", "regression"],
};

export function selectAgents(context: PRContext, config: CortadoConfig): AgentSpec[] {
  const selected = new Map<AgentKind, AgentSpec>();
  const consider = (kind: AgentKind) => {
    if (!selected.has(kind)) selected.set(kind, BASE_AGENTS[kind]);
  };

  consider("bug");
  if (context.tests.length > 0 || context.callers.length > 0) consider("regression");
  if (context.files.some((file) => !["Markdown", "JSON", "Unknown"].includes(file.language))) {
    consider("runtime");
  }

  for (const classification of context.classification) {
    for (const kind of CLASSIFICATION_AGENTS[classification] ?? []) consider(kind);
  }

  for (const signal of context.riskSignals) {
    if (/^(secret|dangerous|crypto)/.test(signal.id)) consider("security");
    if (/^auth/.test(signal.id)) consider("auth");
    if (/^db/.test(signal.id)) consider("database");
    if (/^removed-tests|^api-signature|^net-deletion/.test(signal.id)) consider("regression");
    if (/^perf/.test(signal.id)) consider("performance");
  }

  const limit = config.swarm[context.size] ?? config.swarm.normal;
  return [...selected.values()]
    .sort((a, b) => b.priority - a.priority || a.kind.localeCompare(b.kind))
    .slice(0, limit);
}
