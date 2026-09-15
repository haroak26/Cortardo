import type { Classification, PRContext, ParsedFile, PRSize, ReviewRequest } from "./types";
import { isTestPath, parseChangedFiles } from "./patch";

const ROUTE_EXTRA: Record<string, string> = {
  home: "/home",
  index: "/",
  notfound: "/not-found",
};

export function routeForPage(path: string): string | undefined {
  const match = /(?:^|\/)(?:client|src)\/pages\/(.+)\.(tsx|jsx|ts|js)$/.exec(path);
  if (!match) return undefined;
  const relative = match[1].replace(/\/index$/, "");
  const file = relative.split("/").pop() ?? relative;
  const normalized = file
    .replace(/Page$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
  const key = normalized.replace(/-/g, "");
  if (ROUTE_EXTRA[key] !== undefined) return ROUTE_EXTRA[key];
  const segments = relative
    .split("/")
    .map((segment) =>
      segment
        .replace(/Page$/i, "")
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
        .toLowerCase(),
    );
  return `/${segments.join("/")}`;
}

const AUTH_RE = /(auth|login|logout|session|token|password|credential|permission|role|admin|jwt|oauth|api[_-]?key|secret)/i;
const DB_RE = /(select|insert|update|delete\s+from|query\(|database|migration|schema|prisma|drizzle|postgres|sql|orm|repository)/i;
const API_RE = /(router\.|app\.(get|post|put|patch|delete)|controller|endpoint|handler)/i;
const UI_RE = /(react|jsx|tsx|component|render|innerHTML|dom|usestate|useeffect|css|style)/i;
const PERF_RE = /(performance|cache|memo|index|n\+1|loop|batch|debounce|throttle|complexity|latency)/i;
const CONFIG_RE = /(process\.env|docker|workflow|config|tsconfig|vite\.config|webpack|\.env)/i;

const SECRET_RE = /(api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-./+]{12,}["']/i;
const DANGEROUS_RE = /(eval\(|new Function|child_process|execSync|spawnSync|pickle\.loads|dangerouslySetInnerHTML)/i;
const SQL_CONCAT_RE = /(query|execute|raw)\s*\(\s*[`"'][^`"']*\$\{|`\s*SELECT[\s\S]*\$\{/i;
const AUTH_BYPASS_RE = /(skipAuth|bypass|noAuth|disableAuth|allowAll|verify\s*[:=]\s*false)/i;

const TS_FUNCTION_RE = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const TS_ARROW_RE = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/;
const TS_CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const TS_CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/;

export function extractSymbols(files: ParsedFile[]): PRContext["symbols"] {
  const symbols = new Map<string, PRContext["symbols"][number]>();
  const consider = (file: ParsedFile, text: string, line: number, change: "added" | "removed") => {
    const add = (name: string, kind: string) => {
      const key = `${file.path}:${name}:${kind}`;
      const existing = symbols.get(key);
      if (existing && existing.change !== change) symbols.set(key, { ...existing, change: "modified" });
      else if (!existing) symbols.set(key, { name, kind, file: file.path, line, change });
    };
    const fn = TS_FUNCTION_RE.exec(text);
    if (fn) add(fn[1], "function");
    const arrow = TS_ARROW_RE.exec(text);
    if (arrow) add(arrow[1], "const");
    const cls = TS_CLASS_RE.exec(text);
    if (cls) add(cls[1], "class");
    if (!arrow) {
      const constant = TS_CONST_RE.exec(text);
      if (constant && /^[A-Z]/.test(constant[1])) add(constant[1], "const");
    }
  };
  for (const file of files) {
    if (file.language !== "TypeScript" && file.language !== "JavaScript") continue;
    for (const line of file.addedLines) if (line.newLine !== undefined) consider(file, line.text, line.newLine, "added");
    for (const line of file.removedLines) if (line.oldLine !== undefined) consider(file, line.text, line.oldLine, "removed");
    for (const symbol of symbols.values()) {
      if (symbol.file === file.path && file.lines && symbol.line <= file.lines.length) {
        const actual = file.lines[symbol.line - 1] ?? "";
        if (!actual.includes(symbol.name)) {
          const foundAt = file.lines.findIndex((candidate) => candidate.includes(symbol.name));
          if (foundAt >= 0) symbols.set(`${file.path}:${symbol.name}:${symbol.kind}`, { ...symbol, line: foundAt + 1 });
        }
      }
    }
  }
  return [...symbols.values()];
}

export function classify(files: ParsedFile[], routes: string[]): Classification[] {
  const scores: Record<Exclude<Classification, "UNKNOWN">, number> = {
    AUTH: 0,
    API: 0,
    DATABASE: 0,
    UI: 0,
    PERFORMANCE: 0,
    CONFIG: 0,
  };
  const add = (key: keyof typeof scores, value: number) => {
    scores[key] += value;
  };
  for (const file of files) {
    const path = file.path.toLowerCase();
    if (/(auth|session|login|security)/.test(path)) add("AUTH", 4);
    if (/(route|controller|api|handler|endpoint|server\/)/.test(path)) add("API", 3);
    if (/(migration|model|schema|repository|database|\/db\/)/.test(path)) add("DATABASE", 3);
    if (/(component|view|page|ui|\/client\/)/.test(path)) add("UI", 3);
    if (/(perf|cache|benchmark)/.test(path)) add("PERFORMANCE", 3);
    if (/\.(json|ya?ml|toml|lock)$|\.env/.test(path)) add("CONFIG", 3);
    if (/\.(tsx|jsx)$/.test(file.path)) add("UI", 3);
    for (const line of file.addedLines) {
      const text = line.text;
      if (AUTH_RE.test(text)) add("AUTH", 1);
      if (API_RE.test(text) || /router\.(get|post|put|patch|delete)/.test(text)) add("API", 1);
      if (DB_RE.test(text)) add("DATABASE", 1);
      if (UI_RE.test(text)) add("UI", 1);
      if (PERF_RE.test(text)) add("PERFORMANCE", 1);
      if (CONFIG_RE.test(text)) add("CONFIG", 1);
    }
  }
  if (routes.length > 0) add("API", 2);
  const ranked = (Object.entries(scores) as Array<[Exclude<Classification, "UNKNOWN">, number]>)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
  return ranked.length > 0 ? ranked.slice(0, 3) : ["UNKNOWN"];
}

export function riskSignals(files: ParsedFile[]): string[] {
  const signals = new Set<string>();
  for (const file of files) {
    for (const line of file.addedLines) {
      const text = line.text;
      if (SECRET_RE.test(text)) signals.add(`possible committed credential in ${file.path}`);
      if (DANGEROUS_RE.test(text)) signals.add(`dangerous sink in ${file.path}`);
      if (SQL_CONCAT_RE.test(text)) signals.add(`string-built SQL in ${file.path}`);
      if (AUTH_BYPASS_RE.test(text)) signals.add(`auth bypass marker in ${file.path}`);
      if (/\b(drop\s+table|truncate|delete\s+from)\b/i.test(text)) signals.add(`destructive SQL in ${file.path}`);
      if (/(filter\s*\(\s*\(\s*_\s*,\s*\w+\s*\)\s*=>)/.test(text)) signals.add(`list filtered by index in ${file.path}`);
      if (/(setLocation|navigate|router\.push)\s*\(\s*["'`]\/["'`]\s*\)/.test(text)) signals.add(`navigation to root in ${file.path}`);
    }
    if (isTestPath(file.path) && file.removedLines.some((line) => /expect\s*\(|assert[.(]/.test(line.text))) {
      signals.add(`test assertions removed in ${file.path}`);
    }
  }
  return [...signals];
}

export function computeSize(files: ParsedFile[]): PRSize {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const changed = additions + deletions;
  if (files.length <= 2 && changed <= 60) return "tiny";
  if (files.length > 6 || changed > 400) return "complex";
  return "normal";
}

export function analyzeChanges(request: ReviewRequest): PRContext {
  const files = parseChangedFiles(request.files.map((file) => ({ ...file })));
  const symbols = extractSymbols(files);
  const routes = files
    .flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines.map((line) => line.text)))
    .flatMap((text) => {
      const match = /(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/.exec(text);
      return match ? [match[1]] : [];
    });
  const pages = files
    .map((file) => ({ file: file.path, route: routeForPage(file.path) }))
    .filter((entry): entry is { file: string; route: string } => Boolean(entry.route));
  const tests = files.filter((file) => isTestPath(file.path)).map((file) => file.path);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    id: request.runId,
    title: request.pr.title,
    body: request.pr.body,
    files,
    additions,
    deletions,
    classification: classify(files, routes),
    size: computeSize(files),
    symbols,
    routes,
    tests,
    riskSignals: riskSignals(files),
    pages,
    packageManager: "npm",
    hasTests: false,
    hasTypecheck: false,
    hasBuild: false,
  };
}

export function relevantFiles(candidate: { file?: string }, context: PRContext, limit = 4): ParsedFile[] {
  if (!candidate.file) return context.files.slice(0, limit);
  const found = context.files.find((file) => file.path === candidate.file);
  return found ? [found] : context.files.slice(0, limit);
}
