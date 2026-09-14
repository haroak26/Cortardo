import type {
  ChangedFile,
  ChangedSymbol,
  DependencyEdge,
  DiffLine,
  PRClassification,
  PRContext,
  PRSize,
  PullRequestInput,
  RiskSignal,
  SymbolKind,
} from "../types";
import { parseUnifiedDiff } from "../util/diff";
import { stableId } from "../util/hash";
import { normalizePath, unique } from "../util/text";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  php: "PHP",
  cs: "C#",
  swift: "Swift",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  sh: "Shell",
};

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "Unknown";
}

export function isTestPath(path: string): boolean {
  return /(\.(test|spec)\.[cm]?[jt]sx?$)|(__tests__\/)|((^|\/)(tests?|specs?)\/)/.test(path);
}

export function isConfigPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  if (/\.(md|mdx)$/.test(base)) return false;
  return (
    /\.(json|ya?ml|toml|ini|env|properties|lock)$/.test(base) ||
    /^\.env/.test(base) ||
    /^config\.[a-z]+$/i.test(base) ||
    /^(Dockerfile|Makefile|Procfile|tsconfig.*\.json|vite\.config\.|webpack\.config\.|drizzle\.config\.)/.test(base) ||
    /^\.github\/workflows\//.test(path)
  );
}

export function parseChangedFiles(inputs: PullRequestInput["files"]): ChangedFile[] {
  return inputs.map((input) => {
    const path = normalizePath(input.path);
    const patch = input.patch ?? "";
    const parsed = patch ? parseUnifiedDiff(patch) : [];
    const addedLines: DiffLine[] = [];
    const removedLines: DiffLine[] = [];
    let additions = 0;
    let deletions = 0;
    for (const filePatch of parsed) {
      for (const hunk of filePatch.hunks) {
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.type === " ") {
            oldLine++;
            newLine++;
          } else if (line.type === "-") {
            removedLines.push({ line: oldLine, text: line.text });
            oldLine++;
            deletions++;
          } else {
            addedLines.push({ line: newLine, text: line.text });
            newLine++;
            additions++;
          }
        }
      }
    }
    if (input.additions !== undefined) additions = input.additions;
    if (input.deletions !== undefined) deletions = input.deletions;
    return {
      path,
      status: input.status ?? "modified",
      language: detectLanguage(path),
      additions,
      deletions,
      patch: patch || undefined,
      content: input.content,
      addedLines,
      removedLines,
    };
  });
}

const TS_FUNCTION_RE = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
const TS_ARROW_RE = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/;
const TS_CLASS_RE = /(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const TS_INTERFACE_RE = /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/;
const TS_TYPE_RE = /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/;
const TS_CONST_RE = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/;
const PY_FUNCTION_RE = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/;
const PY_CLASS_RE = /^\s*class\s+([A-Za-z_]\w*)/;
const ROUTE_RE = /\b(?:app|router|server|api)\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(\s*["'`]([^"'`]+)["'`]/;
const TEST_CALL_RE = /\b(it|test|describe)\s*\(\s*["'`]([^"'`]+)["'`]/;

export function extractSymbols(file: ChangedFile): ChangedSymbol[] {
  const symbols = new Map<string, ChangedSymbol>();
  const consider = (line: DiffLine, change: "added" | "removed") => {
    const text = line.text;
    const add = (name: string, kind: SymbolKind) => {
      if (!name) return;
      const key = `${name}:${kind}`;
      const existing = symbols.get(key);
      if (existing && existing.change !== change) {
        symbols.set(key, { ...existing, change: "modified" });
      } else if (!existing) {
        symbols.set(key, { name, kind, file: file.path, line: line.line, change });
      }
    };

    const route = ROUTE_RE.exec(text);
    if (route) add(`${route[1].toUpperCase()} ${route[2]}`, "route");
    if (isTestPath(file.path)) {
      const testCall = TEST_CALL_RE.exec(text);
      if (testCall) add(testCall[2], "test");
    }
    if (file.language === "Python") {
      const pyFn = PY_FUNCTION_RE.exec(text);
      if (pyFn) add(pyFn[1], "function");
      const pyClass = PY_CLASS_RE.exec(text);
      if (pyClass) add(pyClass[1], "class");
      const pyConst = /^\s*([A-Z][A-Z0-9_]{2,})\s*=/.exec(text);
      if (pyConst) add(pyConst[1], "const");
      return;
    }
    const fn = TS_FUNCTION_RE.exec(text);
    if (fn) add(fn[1], "function");
    const arrow = TS_ARROW_RE.exec(text);
    if (arrow) add(arrow[1], file.language === "TypeScript" ? "const" : "function");
    const cls = TS_CLASS_RE.exec(text);
    if (cls) add(cls[1], "class");
    const iface = TS_INTERFACE_RE.exec(text);
    if (iface) add(iface[1], "interface");
    const type = TS_TYPE_RE.exec(text);
    if (type) add(type[1], "type");
    if (!arrow) {
      const constant = TS_CONST_RE.exec(text);
      if (constant) add(constant[1], "const");
    }
  };

  for (const line of file.addedLines) consider(line, "added");
  for (const line of file.removedLines) consider(line, "removed");
  return [...symbols.values()];
}

const IMPORT_RE = /(?:import\s[^"']*from\s*|import\s*|require\s*\(\s*|from\s+)["']([^"']+)["']/g;
const PY_IMPORT_RE = /^\s*from\s+([.\w]+)\s+import\s+/;

export function resolveImport(fromPath: string, specifier: string, knownFiles: string[]): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const fromDir = fromPath.split("/").slice(0, -1);
  const parts = specifier.split("/");
  const stack = [...fromDir];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const base = stack.join("/");
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.py`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}.test.ts`,
  ];
  const normalized = new Set(knownFiles.map(normalizePath));
  return candidates.find((candidate) => normalized.has(candidate));
}

export function extractDependencies(files: ChangedFile[]): DependencyEdge[] {
  const knownFiles = files.map((file) => file.path);
  const edges = new Map<string, DependencyEdge>();
  for (const file of files) {
    const lines = [...file.addedLines, ...file.removedLines];
    for (const line of lines) {
      const python = PY_IMPORT_RE.exec(line.text);
      if (python && python[1].startsWith(".")) {
        const specifier = python[1].replace(/\./g, "/");
        const target = resolveImport(file.path, `.${specifier}`, knownFiles);
        if (target) edges.set(`${file.path}->${target}`, { from: file.path, to: target, kind: "imports" });
      }
      IMPORT_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = IMPORT_RE.exec(line.text)) !== null) {
        const target = resolveImport(file.path, match[1], knownFiles);
        if (target && target !== file.path) {
          edges.set(`${file.path}->${target}`, { from: file.path, to: target, kind: "imports" });
        }
      }
    }
  }
  return [...edges.values()];
}

const AUTH_RE =
  /(auth|login|logout|session|token|password|credential|permission|role|admin|jwt|oauth|api[_-]?key|secret)/i;
const DB_RE = /(select|insert|update|delete\s+from|query\(|database|migration|schema|prisma|drizzle|postgres|sql|orm|repository)/i;
const API_RE = /(router\.|app\.(get|post|put|patch|delete)|controller|endpoint|request|response|handler|http)/i;
const UI_RE = /(react|jsx|tsx|component|render|innerHTML|dom|usestate|useeffect|css|style)/i;
const PERF_RE = /(performance|cache|memo|index|n\+1|loop|batch|debounce|throttle|complexity|latency)/i;
const CONFIG_RE = /(process\.env|docker|workflow|config|tsconfig|vite\.config|webpack|\.env)/i;
const CRYPTO_RE = /(crypto|bcrypt|argon2|hash|encrypt|decrypt|cipher|sign\(|verify\()/i;
const PAYMENT_RE = /(stripe|payment|billing|invoice|checkout|paddle)/i;
const DANGEROUS_RE = /(eval\(|new Function|child_process|execSync|spawnSync|deserialize|pickle\.loads)/i;

const CLASSIFICATION_KEYWORDS: Record<Exclude<PRClassification, "UNKNOWN">, RegExp> = {
  AUTH: AUTH_RE,
  API: API_RE,
  DATABASE: DB_RE,
  UI: UI_RE,
  PERFORMANCE: PERF_RE,
  CONFIG: CONFIG_RE,
};

export function classifyPR(context: {
  files: ChangedFile[];
  symbols: ChangedSymbol[];
  routes: string[];
  riskSignals: RiskSignal[];
}): PRClassification[] {
  const scores: Record<Exclude<PRClassification, "UNKNOWN">, number> = {
    AUTH: 0,
    API: 0,
    DATABASE: 0,
    UI: 0,
    PERFORMANCE: 0,
    CONFIG: 0,
  };
  const add = (category: Exclude<PRClassification, "UNKNOWN">, score: number) => {
    scores[category] += score;
  };

  for (const file of context.files) {
    const path = file.path.toLowerCase();
    if (/(auth|session|login|security)/.test(path)) add("AUTH", 4);
    if (/(route|controller|api|handler|endpoint)/.test(path)) add("API", 3);
    if (/(migration|model|schema|repository|repo|database|db)/.test(path)) add("DATABASE", 3);
    if (/(component|view|page|ui)/.test(path)) add("UI", 3);
    if (/(perf|cache|benchmark)/.test(path)) add("PERFORMANCE", 3);
    if (isConfigPath(file.path)) add("CONFIG", 3);

    for (const line of file.addedLines) {
      const text = line.text;
      if (AUTH_RE.test(text)) add("AUTH", 1);
      if (API_RE.test(text) || ROUTE_RE.test(text)) add("API", 1);
      if (DB_RE.test(text)) add("DATABASE", 1);
      if (UI_RE.test(text)) add("UI", 1);
      if (PERF_RE.test(text) || /\.map\s*\(\s*async/.test(text)) add("PERFORMANCE", 1);
      if (CONFIG_RE.test(text)) add("CONFIG", 1);
    }
    if (/\.(tsx|jsx)$/.test(file.path)) add("UI", 3);
  }

  for (const symbol of context.symbols) {
    if (symbol.kind === "route") add("API", 3);
    if (symbol.kind === "config") add("CONFIG", 2);
  }
  if (context.routes.length > 0) add("API", 2);

  for (const signal of context.riskSignals) {
    if (signal.id.startsWith("auth")) add("AUTH", signal.weight);
    if (signal.id.startsWith("db")) add("DATABASE", signal.weight);
    if (signal.id.startsWith("perf")) add("PERFORMANCE", signal.weight);
    if (signal.id.startsWith("secret") || signal.id.startsWith("config")) add("CONFIG", signal.weight);
    if (signal.id.startsWith("api")) add("API", signal.weight);
  }

  const ranked = (Object.entries(scores) as Array<[Exclude<PRClassification, "UNKNOWN">, number]>)
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([category]) => category);

  if (ranked.length === 0) return ["UNKNOWN"];
  const top = ranked.slice(0, 3);
  return top.length > 0 ? top : ["UNKNOWN"];
}

export function detectRiskSignals(
  files: ChangedFile[],
  symbols: ChangedSymbol[],
): RiskSignal[] {
  const signals = new Map<string, RiskSignal>();
  const add = (id: string, detail: string, weight: number) => {
    const existing = signals.get(id);
    if (existing) existing.weight = Math.max(existing.weight, weight);
    else signals.set(id, { id, detail, weight });
  };

  for (const file of files) {
    const path = file.path;
    for (const line of file.addedLines) {
      const text = line.text;
      if (/\b(drop\s+table|delete\s+from\s+\w+|truncate)\b/i.test(text)) {
        add("db-destructive", `destructive database statement in ${path}`, 3);
      }
      if (/(migrat|alter\s+table|create\s+table)/i.test(text)) {
        add("db-migration", `schema migration touched in ${path}`, 3);
      }
      if (CRYPTO_RE.test(text) && /(password|secret|key|token)/i.test(text)) {
        add("crypto-secret", `credential handling changed in ${path}`, 2);
      }
      if (DANGEROUS_RE.test(text)) {
        add("dangerous-api", `dynamic execution or process spawn in ${path}`, 3);
      }
      if (/(api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-./+]{12,}["']/i.test(text)) {
        add("secret-literal", `possible committed credential in ${path}`, 3);
      }
      if (/(cors|csrf|cookie|session|jwt)/i.test(text)) {
        add("auth-surface", `auth surface changed in ${path}`, 2);
      }
    }
    if (isTestPath(path) && file.removedLines.length > 0) {
      const removedAssertions = file.removedLines.filter((line) => /expect\s*\(|assert[.(]/.test(line.text));
      if (removedAssertions.length > 0) {
        add("removed-tests", `${removedAssertions.length} test assertion(s) removed in ${path}`, 3);
      }
    }
    if (/^\.github\/workflows\//.test(path)) {
      add("ci-change", `CI workflow changed: ${path}`, 2);
    }
    if (/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(path)) {
      add("lockfile-change", `dependency lockfile changed: ${path}`, 1);
    }
    if (/migrat/i.test(path)) {
      add("db-migration", `migration file changed: ${path}`, 2);
    }
  }

  const exportedRemoved = symbols.filter((symbol) => symbol.change === "removed" && symbol.kind !== "test");
  if (exportedRemoved.length > 0) {
    add("api-signature", `exported symbol removed: ${exportedRemoved.map((s) => s.name).join(", ")}`, 3);
  }

  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  if (deletions > additions && deletions > 30) {
    add("net-deletion", `change removes ${deletions - additions} more lines than it adds`, 2);
  }
  if (additions + deletions > 400) {
    add("large-change", `change touches ${additions + deletions} lines`, 1);
  }

  return [...signals.values()].sort((a, b) => b.weight - a.weight);
}

export function computeSize(
  stats: { files: number; additions: number; deletions: number },
  riskSignals: RiskSignal[],
): PRSize {
  const changedLines = stats.additions + stats.deletions;
  if (stats.files <= 2 && changedLines <= 40) return "tiny";
  const riskScore = riskSignals.reduce((sum, signal) => sum + signal.weight, 0);
  if (stats.files > 6 || changedLines > 300 || riskScore >= 9) return "complex";
  return "normal";
}

export function analyzeChange(input: PullRequestInput): PRContext {
  const files = parseChangedFiles(input.files);
  const symbols = files.flatMap((file) => extractSymbols(file));
  const dependencies = extractDependencies(files);
  const routes = unique(
    symbols.filter((symbol) => symbol.kind === "route").map((symbol) => symbol.name),
  );
  const tests = unique(
    files
      .filter((file) => isTestPath(file.path))
      .map((file) => file.path)
      .concat(dependencies.filter((edge) => isTestPath(edge.to)).map((edge) => edge.to)),
  );
  const callers = unique(
    dependencies
      .filter((edge) => files.some((file) => file.path === edge.to))
      .map((edge) => edge.from),
  ).sort();
  const configFiles = files.filter((file) => isConfigPath(file.path)).map((file) => file.path);
  const riskSignals = detectRiskSignals(files, symbols);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const stats = { files: files.length, additions, deletions, changedLines: additions + deletions };
  const classification = classifyPR({ files, symbols, routes, riskSignals });
  const size = computeSize(stats, riskSignals);

  return {
    id: stableId("pr", input.id ?? input.title, files.map((file) => file.path).join(",")),
    title: input.title,
    body: input.body ?? "",
    author: input.author,
    baseBranch: input.baseBranch,
    headBranch: input.headBranch,
    files,
    symbols,
    dependencies,
    callers,
    tests,
    routes,
    configFiles,
    riskSignals,
    classification,
    size,
    stats,
    repoRules: input.repoRules ?? [],
  };
}
