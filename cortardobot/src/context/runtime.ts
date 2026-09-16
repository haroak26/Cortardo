/**
 * Runtime exercise (3.5).
 *
 * Deterministic capability detection and scenario generation. The engine only
 * pays for a sandbox when the diff touches something that can actually run:
 * a changed page, a changed HTTP route, or a CLI entry. Non-runnable repos are
 * skipped with a recorded reason instead of pretending.
 */
import type { PRContext } from "./pack";
import type { ReviewRequest, RuntimeSurface, Severity } from "../types";

export interface RuntimeScenarioSeed {
  id: string;
  surface: RuntimeSurface;
  claim: string;
  file: string;
  line?: number;
  severity: Severity;
  scriptName: string;
  script: string;
  setup: string[];
  teardown: string[];
}

export interface RuntimeCapability {
  enabled: boolean;
  surfaces: RuntimeSurface[];
  devCommand?: string;
  port: number;
  readyPath: string;
  reason?: string;
  seeds: RuntimeScenarioSeed[];
}

const MAX_SCENARIOS = 2;

function parsePackageJson(request: ReviewRequest): { scripts: Record<string, string>; bin?: unknown; dependencies: Record<string, string> } {
  const raw = request.anchors?.["package.json"];
  if (!raw) return { scripts: {}, dependencies: {} };
  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string>; bin?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { scripts: parsed.scripts ?? {}, bin: parsed.bin, dependencies: { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) } };
  } catch {
    return { scripts: {}, dependencies: {} };
  }
}

function repoPaths(request: ReviewRequest, context: PRContext): Set<string> {
  return new Set([...(request.repoFiles ?? []), ...(request.graph?.files ?? []).map((file) => file.path), ...context.changedFiles]);
}

function parsePort(scripts: Record<string, string>): number | undefined {
  for (const command of Object.values(scripts)) {
    const flag = /--port[= ](\d{2,5})|-p[= ](\d{2,5})/.exec(command);
    const env = /PORT=(\d{2,5})/.exec(command);
    const value = Number(flag?.[1] ?? flag?.[2] ?? env?.[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function devCommandFor(paths: Set<string>, scripts: Record<string, string>, port: number): { command: string; kind: "ui" | "server" } | undefined {
  const hasVite = [...paths].some((path) => /(^|\/)vite\.config\.(ts|js|mjs)$/.test(path));
  const hasNext = [...paths].some((path) => /(^|\/)next\.config\.(js|mjs|ts)$/.test(path));
  const hasPython = [...paths].some((path) => /(^|\/)(manage\.py|main\.py)$/.test(path));
  if (scripts.dev || scripts.start) {
    const script = scripts.dev ? "dev" : "start";
    return { command: `npm run ${script} -- --host 127.0.0.1 --port ${port}`, kind: hasVite || hasNext ? "ui" : "server" };
  }
  if (hasVite) return { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort --clearScreen false`, kind: "ui" };
  if (hasNext) return { command: `npx next dev --hostname 127.0.0.1 --port ${port}`, kind: "ui" };
  if (hasPython) return { command: `python3 -m uvicorn main:app --host 127.0.0.1 --port ${port}`, kind: "server" };
  return undefined;
}

function setupFor(devCommand: string, port: number, readyPath: string): { setup: string[]; teardown: string[] } {
  const log = "/tmp/cortado-dev.log";
  return {
    setup: [
      `sh -c 'nohup ${devCommand} > ${log} 2>&1 &'`,
      `sh -c 'for i in $(seq 1 90); do curl -sf -o /dev/null http://127.0.0.1:${port}${readyPath} && exit 0; sleep 1; done; echo "dev server did not start"; tail -n 40 ${log}; exit 1'`,
    ],
    teardown: [`sh -c 'pkill -f "vite" 2>/dev/null; pkill -f "npm run dev" 2>/dev/null; pkill -f "next dev" 2>/dev/null; true'`],
  };
}

function browserScript(base: string, route: string): string {
  return `const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push("pageerror: " + (error && error.message ? error.message : String(error))));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push("console: " + message.text());
  });
  const response = await page.goto(${JSON.stringify(`${base}${route}`)}, { waitUntil: "load", timeout: 45000 });
  await page.waitForTimeout(1500);
  const body = await page.locator("body").innerText().catch(() => "");
  await browser.close();
  if (!response) {
    console.error("route ${route} produced no response");
    process.exit(1);
  }
  if (response.status() >= 400) {
    console.error("route ${route} returned HTTP " + response.status());
    process.exit(1);
  }
  if (errors.length > 0) {
    console.error("runtime errors on ${route}:\\n" + errors.join("\\n"));
    process.exit(1);
  }
  if (!body || !body.trim()) {
    console.error("route ${route} rendered an empty body");
    process.exit(1);
  }
  console.log("ok");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;
}

function httpScript(base: string, method: string, path: string): string {
  return `const url = ${JSON.stringify(`${base}${path}`)};

(async () => {
  let response;
  try {
    response = await fetch(url, { method: ${JSON.stringify(method.toUpperCase())}, redirect: "manual" });
  } catch (error) {
    console.error("request to ${path} failed: " + (error && error.message ? error.message : String(error)));
    process.exit(1);
  }
  const text = await response.text().catch(() => "");
  if (response.status >= 500) {
    console.error("route ${path} returned HTTP " + response.status + ": " + text.slice(0, 300));
    process.exit(1);
  }
  console.log("ok " + response.status);
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;
}

function routeSeedsIn(file: { path: string; content?: string }): Array<{ method: string; path: string; line: number }> {
  if (!file.content) return [];
  const out: Array<{ method: string; path: string; line: number }> = [];
  const regex = /\b(?:app|router|server)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const lines = file.content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(regex)) {
      out.push({ method: match[1], path: match[2], line: index + 1 });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/**
 * Detects runnable surfaces and generates deterministic smoke scenarios for the
 * changed code. No sandbox is touched here; the caller decides whether to run.
 */
export function detectRuntime(request: ReviewRequest, context: PRContext): RuntimeCapability {
  const base: RuntimeCapability = { enabled: false, surfaces: [], port: 4173, readyPath: "/", seeds: [] };
  if (request.settings.runtime === false) return { ...base, reason: "runtime exercise is disabled for this repository" };
  if (["0", "false", "off", "no"].includes((process.env.CORTADO_RUNTIME ?? "").trim().toLowerCase())) {
    return { ...base, reason: "runtime exercise is disabled by CORTADO_RUNTIME" };
  }

  const { scripts, bin, dependencies } = parsePackageJson(request);
  const paths = repoPaths(request, context);
  const port = parsePort(scripts) ?? 4173;
  const dev = devCommandFor(paths, scripts, port);
  const hasServerDeps = Boolean(dependencies.express || dependencies.fastify || dependencies.hono || dependencies.koa || dependencies["@nestjs/core"]);
  const hasClient = Boolean(dependencies.react || dependencies.vue || dependencies.svelte || dependencies.next);
  const surfaces: RuntimeSurface[] = [];
  const seeds: RuntimeScenarioSeed[] = [];
  const baseUrl = `http://127.0.0.1:${port}`;

  const changed = context.changed;
  const uiRoutes = context.routes.slice(0, MAX_SCENARIOS);
  if (dev && dev.kind === "ui" && (uiRoutes.length > 0 || hasClient)) {
    const routes = uiRoutes.length > 0 ? uiRoutes : ["/"];
    const { setup, teardown } = setupFor(dev.command, port, "/");
    surfaces.push("ui");
    for (const route of routes) {
      const changedFile = changed.find((file) => /\/pages\//.test(file.path) && context.routes.includes(route));
      seeds.push({
        id: `ui:${route}`,
        surface: "ui",
        claim: `the page ${route} crashes or renders errors at runtime`,
        file: changedFile?.path ?? changed[0]?.path ?? "package.json",
        line: changedFile?.hunks.flatMap((hunk) => hunk.lines).find((line) => line.type === "+")?.newLine,
        severity: "high",
        scriptName: `runtime-ui-${route.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "root"}.mjs`,
        script: browserScript(baseUrl, route),
        setup,
        teardown,
      });
    }
  }

  const apiCandidates = changed.filter((file) => /\.(ts|js|tsx|jsx|py)$/.test(file.path) && (hasServerDeps || /\/(server|api|routes)\//.test(file.path) || /\/(routes|controllers)\//.test(file.path)));
  const apiRoutes: Array<{ method: string; path: string; file: string; line: number }> = [];
  for (const file of apiCandidates) {
    for (const route of routeSeedsIn(file)) apiRoutes.push({ ...route, file: file.path });
    if (apiRoutes.length >= MAX_SCENARIOS) break;
  }
  if (dev && apiRoutes.length > 0) {
    const { setup, teardown } = setupFor(dev.command, port, "/");
    if (!surfaces.includes("api")) surfaces.push("api");
    for (const route of apiRoutes.slice(0, MAX_SCENARIOS)) {
      seeds.push({
        id: `api:${route.method}:${route.path}`,
        surface: "api",
        claim: `the route ${route.method.toUpperCase()} ${route.path} returns a server error at runtime`,
        file: route.file,
        line: route.line,
        severity: "high",
        scriptName: `runtime-api-${route.method}-${route.path.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "")}.mjs`,
        script: httpScript(baseUrl, route.method, route.path),
        setup,
        teardown,
      });
    }
  }

  const cliBin = typeof bin === "string" ? bin : bin && typeof bin === "object" ? Object.values(bin as Record<string, unknown>).find((value) => typeof value === "string") : undefined;
  const cliFile = typeof cliBin === "string" ? cliBin.replace(/^\.\//, "") : undefined;
  if (surfaces.length === 0 && cliFile && paths.has(cliFile) && context.changedFiles.includes(cliFile)) {
    surfaces.push("cli");
    seeds.push({
      id: `cli:${cliFile}`,
      surface: "cli",
      claim: `the CLI entry ${cliFile} fails at startup`,
      file: cliFile,
      severity: "medium",
      scriptName: "runtime-cli.mjs",
      script: `import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, [${JSON.stringify(cliFile)}, "--help"], { encoding: "utf8", timeout: 60000 });
const output = (result.stdout || "") + (result.stderr || "");
if (result.error) {
  console.error("the CLI failed to start: " + result.error.message);
  process.exit(1);
}
if (typeof result.status === "number" && result.status >= 2 && !/usage|help/i.test(output)) {
  console.error("the CLI exited with " + result.status + ": " + output.slice(0, 300));
  process.exit(1);
}
console.log("ok");
`,
      setup: [],
      teardown: [],
    });
  }

  if (surfaces.length === 0 || seeds.length === 0) {
    return { ...base, reason: "the changed code has no runnable surface (no page, route or CLI entry)" };
  }
  return { enabled: true, surfaces, devCommand: dev?.command, port, readyPath: "/", seeds: seeds.slice(0, MAX_SCENARIOS * 2) };
}
