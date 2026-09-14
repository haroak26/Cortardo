import { existsSync } from "node:fs";
import path from "node:path";
import { Language, Parser, type Node as SyntaxNode } from "web-tree-sitter";
import type {
  CodeFileKind,
  CodeGraphConnection,
  CodeGraphFile,
  CodeGraphSymbol,
  CodeGraphSymbolEdge,
  CodeSymbolKind,
  ConnectionKind,
} from "@shared/codegraph";

export interface SourceFile {
  path: string;
  content: string;
}

export interface AnalyzeResult {
  files: CodeGraphFile[];
  connections: CodeGraphConnection[];
  symbols: CodeGraphSymbol[];
  symbolEdges: CodeGraphSymbolEdge[];
  parser: "tree-sitter" | "regex";
}

/**
 * Serializable per-file analysis. Persisted so incremental reindexing only has
 * to reparse files whose content hash changed.
 */
/** Bump when parsing output changes so incremental reindex reparses files. */
export const ANALYZE_VERSION = 3;

export interface FileAnalysis {
  analyzeVersion?: number;
  path: string;
  language: string;
  kind: CodeFileKind;
  loc: number;
  imports: Array<[string, string]>;
  namespaces: Array<[string, string]>;
  calls: string[];
  types: string[];
  declarations: Array<[string, "function" | "class" | "type" | "var"]>;
  symbols: CodeGraphSymbol[];
  symbolCalls: Array<{ from: string; name: string; kind: "calls" | "references" }>;
  /** String literals with their line numbers — plan IDs, routes, flags, keys. */
  strings?: Array<{ value: string; line: number }>;
  aliases?: AliasConfig;
}

type LanguageKey = "typescript" | "tsx" | "javascript" | "python";

const LANGUAGE_FILES: Record<LanguageKey, { pkg: string; file: string }> = {
  typescript: { pkg: "tree-sitter-typescript", file: "tree-sitter-typescript.wasm" },
  tsx: { pkg: "tree-sitter-typescript", file: "tree-sitter-tsx.wasm" },
  javascript: { pkg: "tree-sitter-javascript", file: "tree-sitter-javascript.wasm" },
  python: { pkg: "tree-sitter-python", file: "tree-sitter-python.wasm" },
};

const EXTENSION_LANGUAGE: Record<string, LanguageKey> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
};

const LANGUAGE_LABELS: Record<LanguageKey, string> = {
  typescript: "TypeScript",
  tsx: "TSX",
  javascript: "JavaScript",
  python: "Python",
};

const EXTENSION_LABELS: Record<string, string> = {
  ".json": "JSON",
  ".yml": "YAML",
  ".yaml": "YAML",
  ".toml": "TOML",
  ".md": "Markdown",
  ".mdx": "MDX",
  ".css": "CSS",
  ".scss": "SCSS",
  ".html": "HTML",
  ".sh": "Shell",
  ".sql": "SQL",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".rb": "Ruby",
  ".php": "PHP",
  ".c": "C",
  ".h": "C",
  ".cpp": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".swift": "Swift",
  ".kt": "Kotlin",
  ".dockerfile": "Docker",
};

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const MAX_CONNECTIONS = 8000;
const MAX_SYMBOL_EDGES = 20_000;

const ENTRY_NAMES = new Set([
  "index",
  "main",
  "app",
  "server",
  "client",
  "manage",
  "__main__",
  "cli",
  "bootstrap",
]);

const CONFIG_NAMES = new Set([
  "package.json",
  "tsconfig.json",
  "vite.config.ts",
  "vite.config.js",
  "drizzle.config.ts",
  "tailwind.config.ts",
  "tailwind.config.js",
  "postcss.config.js",
  "next.config.js",
  "next.config.mjs",
  "nuxt.config.ts",
  "jest.config.js",
  "vitest.config.ts",
  "eslint.config.js",
  ".eslintrc.json",
  "dockerfile",
  "makefile",
  "pyproject.toml",
  "requirements.txt",
  "cargo.toml",
  "go.mod",
  "gemfile",
]);

function stripExtension(filePath: string): string {
  return filePath.replace(/\.[^./]+$/, "");
}

function extensionOf(filePath: string): string {
  const base = path.posix.basename(filePath);
  if (base.toLowerCase() === "dockerfile") return ".dockerfile";
  const ext = path.posix.extname(base);
  return ext.toLowerCase();
}

export function kindOf(filePath: string): CodeFileKind {
  const lower = filePath.toLowerCase();
  const base = path.posix.basename(lower);
  if (
    lower.includes(".test.") ||
    lower.includes(".spec.") ||
    lower.includes("__tests__/") ||
    lower.includes("__mocks__/") ||
    /(^|\/)(tests?|specs?)\//.test(lower) ||
    /(^|\/)test_[^/]+\.py$/.test(lower) ||
    /_test\.py$/.test(lower)
  ) {
    return "test";
  }
  if (
    CONFIG_NAMES.has(base) ||
    /\.(json|ya?ml|toml|ini|cfg|lock)$/.test(lower) ||
    /(^|\/)(config|\.config|\.github)\//.test(lower) ||
    /(^|\/)\.env/.test(lower)
  ) {
    return "config";
  }
  if (
    /\.(md|mdx|txt|rst)$/.test(lower) ||
    /(^|\/)docs?\//.test(lower) ||
    /(^|\/)(readme|changelog|license|contributing)(\.|$)/.test(lower)
  ) {
    return "docs";
  }
  return "source";
}

export function languageOf(filePath: string): string {
  const ext = extensionOf(filePath);
  const key = EXTENSION_LANGUAGE[ext];
  if (key) return LANGUAGE_LABELS[key];
  if (EXTENSION_LABELS[ext]) return EXTENSION_LABELS[ext];
  const fallback = ext.replace(/^\./, "").toUpperCase();
  return fallback || "Text";
}

function isEntryFile(filePath: string, kind: CodeFileKind): boolean {
  if (kind !== "source") return false;
  const base = stripExtension(path.posix.basename(filePath));
  if (!ENTRY_NAMES.has(base)) return false;
  const depth = filePath.split("/").length;
  return depth <= 3 || filePath.includes("/src/");
}

export function fileKindAndLanguage(filePath: string): { kind: CodeFileKind; language: string } {
  return { kind: kindOf(filePath), language: languageOf(filePath) };
}

function createFile(filePath: string, loc: number): CodeGraphFile {
  const name = path.posix.basename(filePath);
  const dir = path.posix.dirname(filePath);
  const kind = kindOf(filePath);
  return {
    id: filePath,
    path: filePath,
    name,
    dir: dir === "." ? "." : dir,
    language: languageOf(filePath),
    kind,
    loc,
    entry: isEntryFile(filePath, kind) || undefined,
  };
}

interface ParsedFile {
  id: string;
  language: LanguageKey;
  imports: Map<string, string>;
  namespaces: Map<string, string>;
  calls: Set<string>;
  types: Set<string>;
  declarations: Map<string, "function" | "class" | "type" | "var">;
  symbols: CodeGraphSymbol[];
  symbolCalls: Array<{ from: string; name: string; kind: "calls" | "references" }>;
}

export interface AliasRule {
  pattern: string;
  targets: string[];
  base: string;
}

export interface AliasConfig {
  rules: AliasRule[];
  baseUrls: string[];
}

/** tsconfig/jsconfig files allow comments and trailing commas. */
function parseJsonc(text: string): Record<string, any> | null {
  try {
    const cleaned = text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

export function collectAliasConfig(files: SourceFile[]): AliasConfig {
  const config: AliasConfig = { rules: [], baseUrls: [] };
  for (const file of files) {
    const base = path.posix.basename(file.path);
    if (base !== "tsconfig.json" && base !== "jsconfig.json") continue;
    const parsed = parseJsonc(file.content);
    const options = parsed?.compilerOptions;
    if (!options) continue;
    const dir = path.posix.dirname(file.path);
    const baseUrl = path.posix.normalize(path.posix.join(dir, options.baseUrl || "."));
    config.baseUrls.push(baseUrl);
    const paths = options.paths as Record<string, string[]> | undefined;
    if (paths) {
      for (const [pattern, targets] of Object.entries(paths)) {
        if (Array.isArray(targets) && targets.length > 0) {
          config.rules.push({ pattern, targets, base: baseUrl });
        }
      }
    }
  }
  return config;
}

function resolveWithExtensions(raw: string, fileIds: Set<string>): string | null {
  const candidates: string[] = [raw];
  const ext = path.posix.extname(raw);
  if (ext) {
    candidates.push(stripExtension(raw));
    for (const jsExt of JS_EXTENSIONS) {
      candidates.push(`${stripExtension(raw)}${jsExt}`);
    }
  }
  for (const candidate of [...candidates]) {
    for (const jsExt of JS_EXTENSIONS) {
      candidates.push(`${candidate}${jsExt}`);
      candidates.push(`${candidate}/index${jsExt}`);
    }
  }
  for (const candidate of candidates) {
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

export function resolveJsSpecifier(
  fromFile: string,
  specifier: string,
  fileIds: Set<string>,
  aliases: AliasConfig = { rules: [], baseUrls: [] },
): string | null {
  if (specifier.startsWith(".")) {
    const baseDir = path.posix.dirname(fromFile);
    const raw = path.posix.normalize(path.posix.join(baseDir, specifier));
    if (raw.startsWith("..")) return null;
    return resolveWithExtensions(raw, fileIds);
  }
  if (specifier.startsWith("/")) return null;

  for (const rule of aliases.rules) {
    const star = rule.pattern.indexOf("*");
    let capture: string;
    if (star === -1) {
      if (specifier !== rule.pattern) continue;
      capture = "";
    } else {
      const prefix = rule.pattern.slice(0, star);
      const suffix = rule.pattern.slice(star + 1);
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) continue;
      capture = specifier.slice(prefix.length, specifier.length - suffix.length);
    }
    for (const target of rule.targets) {
      const substituted = target.includes("*") ? target.replace("*", capture) : target;
      const candidate = path.posix.normalize(path.posix.join(rule.base, substituted));
      const resolved = resolveWithExtensions(candidate, fileIds);
      if (resolved) return resolved;
    }
  }

  for (const baseUrl of aliases.baseUrls) {
    const resolved = resolveWithExtensions(
      path.posix.normalize(path.posix.join(baseUrl, specifier)),
      fileIds,
    );
    if (resolved) return resolved;
  }

  // Alias-less fallbacks for common monorepo roots.
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    for (const root of ["", "src/", "client/src/", "app/", "src/app/"]) {
      const resolved = resolveWithExtensions(path.posix.normalize(`${root}${relative}`), fileIds);
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolvePythonModule(
  fromFile: string,
  moduleText: string,
  fileIds: Set<string>,
): string | null {
  const trimmed = moduleText.trim().replace(/[()]/g, "");
  if (!trimmed) return null;

  const resolve = (base: string, parts: string[]): string | null => {
    const raw = parts.filter(Boolean).join("/");
    const modulePath = base && raw ? `${base}/${raw}` : base || raw;
    const candidates = raw
      ? [`${modulePath}.py`, `${modulePath}/__init__.py`]
      : [`${modulePath}/__init__.py`, `${modulePath}.py`];
    for (const candidate of candidates) {
      if (fileIds.has(candidate)) return candidate;
    }
    return null;
  };

  if (trimmed.startsWith(".")) {
    const level = trimmed.match(/^\.+/)?.[0].length ?? 1;
    const parts = trimmed.slice(level).split(".");
    let base = path.posix.dirname(fromFile);
    for (let i = 1; i < level; i++) base = path.posix.dirname(base);
    return resolve(base, parts);
  }

  const parts = trimmed.split(".");
  const direct = resolve("", parts);
  if (direct) return direct;
  return resolve("src", parts);
}

function firstStringArgument(node: SyntaxNode): string | null {
  const args = node.childForFieldName("arguments");
  const first = args?.namedChildren.find((child) => child.type === "string");
  return first ? first.text.replace(/^['"`]|['"`]$/g, "") : null;
}

function declarationKindFor(node: SyntaxNode): "function" | "class" | "type" | "var" {
  switch (node.type) {
    case "function_declaration":
    case "function_definition":
    case "method_definition":
    case "generator_function_declaration":
      return "function";
    case "class_declaration":
    case "class_definition":
      return "class";
    case "interface_declaration":
    case "type_alias_declaration":
      return "type";
    default:
      return "var";
  }
}

function symbolSignature(node: SyntaxNode): string {
  const name = node.childForFieldName("name")?.text ?? "";
  const params = node.childForFieldName("parameters");
  const raw = params ? `${name}${params.text}` : node.text.split("\n")[0];
  return raw.replace(/\s+/g, " ").trim().slice(0, 240);
}

function registerImportClause(node: SyntaxNode, specifier: string, parsed: ParsedFile): void {
  const clause = node.childForFieldName("import_clause") ?? node.namedChildren.find((c) => c.type === "import_clause");
  if (!clause) return;
  for (const child of clause.namedChildren) {
    if (child.type === "identifier") parsed.imports.set(child.text, specifier);
    if (child.type === "named_imports") {
      for (const specifierNode of child.namedChildren) {
        if (specifierNode.type !== "import_specifier") continue;
        const name = specifierNode.childForFieldName("name");
        const alias = specifierNode.childForFieldName("alias");
        parsed.imports.set(alias?.text ?? name?.text ?? specifierNode.text, specifier);
      }
    }
    if (child.type === "namespace_import") {
      const name = child.namedChildren.find((c) => c.type === "identifier");
      if (name) parsed.namespaces.set(name.text, specifier);
    }
  }
}

function parseTypeScriptFile(rootNode: SyntaxNode, id: string, language: LanguageKey): ParsedFile {
  const parsed: ParsedFile = {
    id,
    language,
    imports: new Map(),
    namespaces: new Map(),
    calls: new Set(),
    types: new Set(),
    declarations: new Map(),
    symbols: [],
    symbolCalls: [],
  };

  const visit = (node: SyntaxNode, enclosing: { id: string; name: string } | null, exported: boolean): void => {
    switch (node.type) {
      case "export_statement": {
        const source = node.childForFieldName("source");
        if (source) {
          const specifier = source.text.replace(/^['"`]|['"`]$/g, "");
          registerImportClause(node, specifier, parsed);
        }
        for (const child of node.namedChildren) visit(child, enclosing, true);
        return;
      }
      case "import_statement": {
        const source = node.childForFieldName("source");
        if (source) {
          const specifier = source.text.replace(/^['"`]|['"`]$/g, "");
          registerImportClause(node, specifier, parsed);
        }
        break;
      }
      case "call_expression":
      case "new_expression": {
        const fn = node.childForFieldName("constructor") ?? node.childForFieldName("function");
        if (fn?.type === "identifier") {
          parsed.calls.add(fn.text);
          if (enclosing) parsed.symbolCalls.push({ from: enclosing.id, name: fn.text, kind: "calls" });
        }
        if (fn?.type === "import" || fn?.text === "require") {
          const specifier = firstStringArgument(node);
          if (specifier) parsed.imports.set(`__module_${parsed.imports.size}`, specifier);
        }
        if (fn?.type === "member_expression") {
          const object = fn.childForFieldName("object");
          const property = fn.childForFieldName("property");
          if (object?.type === "identifier" && property) {
            parsed.namespaces.set(`${object.text}.${property.text}`, parsed.namespaces.get(object.text) ?? "");
            parsed.calls.add(`${object.text}.${property.text}`);
            if (enclosing) {
              parsed.symbolCalls.push({ from: enclosing.id, name: `${object.text}.${property.text}`, kind: "calls" });
            }
          }
        }
        break;
      }
      case "type_identifier":
        parsed.types.add(node.text);
        if (enclosing && parsed.symbolCalls.length < 2000) {
          parsed.symbolCalls.push({ from: enclosing.id, name: node.text, kind: "references" });
        }
        break;
      case "identifier": {
        // Non-call usages (JSX tags, passed functions, values) still form
        // impact relationships. Declaration names are handled separately.
        const parent = node.parent;
        if (parent) {
          const nameField = parent.childForFieldName?.("name");
          if (
            nameField === node &&
            ["variable_declarator", "function_declaration", "class_declaration", "method_definition", "interface_declaration", "type_alias_declaration"].includes(parent.type)
          ) {
            break;
          }
        }
        if (
          node.parent?.type === "import_clause" ||
          node.parent?.type === "named_imports" ||
          node.parent?.type === "import_specifier" ||
          (node.parent?.type ?? "").includes("parameter") ||
          node.parent?.type === "formal_parameters"
        ) {
          break;
        }
        if (enclosing && parsed.symbolCalls.length < 2000) {
          parsed.symbolCalls.push({ from: enclosing.id, name: node.text, kind: "references" });
        }
        break;
      }
      case "function_declaration":
      case "generator_function_declaration":
      case "class_declaration":
      case "interface_declaration":
      case "type_alias_declaration":
      case "method_definition": {
        const nameNode = node.childForFieldName("name");
        if (!nameNode) break;
        const name = nameNode.text;
        const kind: CodeSymbolKind =
          node.type === "method_definition" ? "method" : (declarationKindFor(node) as CodeSymbolKind);
        parsed.declarations.set(name, kind === "method" ? "function" : (kind as "function" | "class" | "type" | "var"));
        const qualifiedName = enclosing ? `${enclosing.name}.${name}` : name;
        const symbol: CodeGraphSymbol = {
          id: `${id}#${qualifiedName}`,
          fileId: id,
          name,
          qualifiedName,
          kind,
          line: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          signature: symbolSignature(node),
          exported,
          parent: enclosing?.id ?? null,
        };
        parsed.symbols.push(symbol);
        if (kind === "function" || kind === "method" || kind === "class") {
          for (const child of node.namedChildren) {
            if (child === nameNode) continue;
            visit(child, { id: symbol.id, name: qualifiedName }, exported);
          }
          return;
        }
        break;
      }
      case "variable_declarator": {
        const nameNode = node.childForFieldName("name");
        const value = node.childForFieldName("value");
        if (nameNode?.type === "identifier") {
          const isFunction = value?.type === "arrow_function" || value?.type === "function_expression";
          parsed.declarations.set(nameNode.text, isFunction ? "function" : "var");
          const qualifiedName = enclosing ? `${enclosing.name}.${nameNode.text}` : nameNode.text;
          const symbol: CodeGraphSymbol = {
            id: `${id}#${qualifiedName}`,
            fileId: id,
            name: nameNode.text,
            qualifiedName,
            kind: isFunction ? "function" : "var",
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature: symbolSignature(node),
            exported,
            parent: enclosing?.id ?? null,
          };
          parsed.symbols.push(symbol);
          if (isFunction && value) {
            for (const child of value.namedChildren) {
              visit(child, { id: symbol.id, name: qualifiedName }, exported);
            }
            return;
          }
        }
        break;
      }
      default:
        break;
    }
    for (const child of node.namedChildren) visit(child, enclosing, exported);
  };

  visit(rootNode, null, false);
  return parsed;
}

function parsePythonFile(rootNode: SyntaxNode, id: string): ParsedFile {
  const parsed: ParsedFile = {
    id,
    language: "python",
    imports: new Map(),
    namespaces: new Map(),
    calls: new Set(),
    types: new Set(),
    declarations: new Map(),
    symbols: [],
    symbolCalls: [],
  };

  const visit = (node: SyntaxNode, enclosing: { id: string; name: string } | null): void => {
    switch (node.type) {
      case "import_statement": {
        for (const child of node.namedChildren) {
          if (child.type === "dotted_name") parsed.imports.set(child.text, child.text);
          if (child.type === "aliased_import") {
            const alias = child.namedChildren.find((c) => c.type === "identifier");
            const moduleName = child.namedChildren.find((c) => c.type === "dotted_name");
            parsed.imports.set(alias?.text ?? moduleName?.text ?? child.text, moduleName?.text ?? child.text);
          }
        }
        break;
      }
      case "import_from_statement": {
        const moduleNode = node.childForFieldName("module_name");
        const moduleText = moduleNode?.text ?? "";
        for (const child of node.namedChildren) {
          if (child === moduleNode) continue;
          if (child.type === "dotted_name") {
            const name = child.text.split(".").pop() ?? child.text;
            parsed.imports.set(name, moduleText);
          }
          if (child.type === "aliased_import") {
            const alias = child.namedChildren.find((c) => c.type === "identifier");
            const target = child.namedChildren.find((c) => c.type === "dotted_name");
            const name = alias?.text ?? target?.text ?? child.text;
            parsed.imports.set(name, moduleText);
          }
        }
        break;
      }
      case "call": {
        const fn = node.childForFieldName("function");
        if (fn?.type === "identifier") {
          parsed.calls.add(fn.text);
          if (enclosing) parsed.symbolCalls.push({ from: enclosing.id, name: fn.text, kind: "calls" });
        }
        if (fn?.type === "attribute") {
          const object = fn.childForFieldName("object");
          const attribute = fn.childForFieldName("attribute");
          if (object?.type === "identifier" && attribute) {
            parsed.calls.add(`${object.text}.${attribute.text}`);
            if (enclosing) {
              parsed.symbolCalls.push({ from: enclosing.id, name: `${object.text}.${attribute.text}`, kind: "calls" });
            }
          }
        }
        break;
      }
      case "function_definition":
      case "class_definition": {
        const nameNode = node.childForFieldName("name");
        if (nameNode) {
          const isClass = node.type === "class_definition";
          const kind: CodeSymbolKind = isClass ? "class" : enclosing ? "method" : "function";
          parsed.declarations.set(nameNode.text, isClass ? "class" : "function");
          const qualifiedName = enclosing ? `${enclosing.name}.${nameNode.text}` : nameNode.text;
          const symbol: CodeGraphSymbol = {
            id: `${id}#${qualifiedName}`,
            fileId: id,
            name: nameNode.text,
            qualifiedName,
            kind,
            line: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            signature: symbolSignature(node),
            exported: !nameNode.text.startsWith("_"),
            parent: enclosing?.id ?? null,
          };
          parsed.symbols.push(symbol);
          for (const child of node.namedChildren) {
            if (child === nameNode) continue;
            visit(child, { id: symbol.id, name: qualifiedName });
          }
          return;
        }
        break;
      }
      case "assignment": {
        const left = node.childForFieldName("left");
        if (left?.type === "identifier") parsed.declarations.set(left.text, "var");
        break;
      }
      default:
        break;
    }
    for (const child of node.namedChildren) visit(child, enclosing);
  };

  visit(rootNode, null);
  return parsed;
}

let parserPromise: Promise<Map<LanguageKey, Parser>> | null = null;

function wasmPath(pkg: string, file: string): string {
  const direct = path.join(process.cwd(), "node_modules", pkg, file);
  if (existsSync(direct)) return direct;
  return path.join(process.cwd(), "server", "node_modules", pkg, file);
}

async function getParsers(): Promise<Map<LanguageKey, Parser>> {
  if (parserPromise) return parserPromise;
  parserPromise = (async () => {
    await Parser.init({
      locateFile: (scriptName: string) =>
        existsSync(path.join(process.cwd(), "node_modules", "web-tree-sitter", scriptName))
          ? path.join(process.cwd(), "node_modules", "web-tree-sitter", scriptName)
          : scriptName,
    });

    const parsers = new Map<LanguageKey, Parser>();
    for (const [key, { pkg, file }] of Object.entries(LANGUAGE_FILES) as Array<
      [LanguageKey, { pkg: string; file: string }]
    >) {
      const language = await Language.load(wasmPath(pkg, file));
      const parser = new Parser();
      parser.setLanguage(language);
      parsers.set(key, parser);
    }
    return parsers;
  })();
  return parserPromise;
}

/** Resilience fallback if the WASM grammars cannot be loaded (e.g. bundled runtime). */
function parseWithRegex(file: SourceFile): ParsedFile {
  const id = file.path;
  const ext = extensionOf(id);
  const language = EXTENSION_LANGUAGE[ext] ?? "javascript";
  const parsed: ParsedFile = {
    id,
    language,
    imports: new Map(),
    namespaces: new Map(),
    calls: new Set(),
    types: new Set(),
    declarations: new Map(),
    symbols: [],
    symbolCalls: [],
  };

  const lineOf = (index: number) => file.content.slice(0, index).split("\n").length || 1;

  if (language === "python") {
    for (const match of file.content.matchAll(/^\s*from\s+([.\w]+)\s+import\s+([^\n#]+)/gm)) {
      const moduleText = match[1];
      const names = match[2].replace(/[()]/g, "").split(",");
      for (const raw of names) {
        const name = raw.trim().split(/\s+as\s+/)[0]?.trim();
        if (name) parsed.imports.set(name, moduleText);
      }
    }
    for (const match of file.content.matchAll(/^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm)) {
      parsed.imports.set(match[2] ?? match[1].split(".")[0], match[1]);
    }
    for (const match of file.content.matchAll(/^\s*def\s+(\w+)/gm)) {
      const name = match[1];
      parsed.declarations.set(name, "function");
      parsed.symbols.push({
        id: `${id}#${name}`,
        fileId: id,
        name,
        qualifiedName: name,
        kind: "function",
        line: lineOf(match.index ?? 0),
        endLine: lineOf(match.index ?? 0),
        signature: `def ${name}`,
        exported: !name.startsWith("_"),
        parent: null,
      });
    }
    for (const match of file.content.matchAll(/^\s*class\s+(\w+)/gm)) {
      const name = match[1];
      parsed.declarations.set(name, "class");
      parsed.symbols.push({
        id: `${id}#${name}`,
        fileId: id,
        name,
        qualifiedName: name,
        kind: "class",
        line: lineOf(match.index ?? 0),
        endLine: lineOf(match.index ?? 0),
        signature: `class ${name}`,
        exported: !name.startsWith("_"),
        parent: null,
      });
    }
    return parsed;
  }

  for (const match of file.content.matchAll(
    /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g,
  )) {
    parsed.imports.set(`__module_${parsed.imports.size}`, match[1]);
  }
  for (const match of file.content.matchAll(/import\s+['"]([^'"]+)['"]/g)) {
    parsed.imports.set(`__side_${parsed.imports.size}`, match[1]);
  }
  for (const match of file.content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    parsed.imports.set(`__require_${parsed.imports.size}`, match[1]);
  }
  for (const match of file.content.matchAll(/(?:function|class|interface|type|const|let|var)\s+(\w+)/g)) {
    const name = match[1];
    const kind: CodeSymbolKind = match[0].startsWith("class") ? "class" : "function";
    parsed.declarations.set(name, match[0].startsWith("class") ? "class" : "function");
    parsed.symbols.push({
      id: `${id}#${name}`,
      fileId: id,
      name,
      qualifiedName: name,
      kind,
      line: lineOf(match.index ?? 0),
      endLine: lineOf(match.index ?? 0),
      signature: match[0].slice(0, 240),
      exported: true,
      parent: null,
    });
  }
  return parsed;
}

function toFileAnalysis(parsed: ParsedFile, file: SourceFile, kind: CodeFileKind, loc: number, aliases?: AliasConfig): FileAnalysis {
  return {
    analyzeVersion: ANALYZE_VERSION,
    path: file.path,
    language: languageOf(file.path),
    kind,
    loc,
    imports: [...parsed.imports.entries()],
    namespaces: [...parsed.namespaces.entries()],
    calls: [...parsed.calls],
    types: [...parsed.types],
    declarations: [...parsed.declarations.entries()],
    symbols: parsed.symbols,
    symbolCalls: parsed.symbolCalls,
    strings: extractStringRefs(file.content),
    ...(aliases ? { aliases } : {}),
  };
}

/**
 * Collect string literals per line. Identifiers alone miss plan IDs, feature
 * flags, route names and config keys, so the reference map can trace them back
 * to the files that still use them.
 */
export function extractStringRefs(content: string): Array<{ value: string; line: number }> {
  const refs: Array<{ value: string; line: number }> = [];
  const seen = new Set<string>();
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(/["'`]([^"'`\n]{2,64})["'`]/g)) {
      const value = match[1].trim();
      if (!value || !/[A-Za-z]/.test(value)) continue;
      if (value.includes("/") || value.includes("\\") || value.includes("\n")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      refs.push({ value, line: index + 1 });
      if (refs.length >= 120) return refs;
    }
  }
  return refs;
}

function fromFileAnalysis(analysis: FileAnalysis): ParsedFile {
  const languageKey = EXTENSION_LANGUAGE[extensionOf(analysis.path)] ?? "javascript";
  return {
    id: analysis.path,
    language: languageKey,
    imports: new Map(analysis.imports ?? []),
    namespaces: new Map(analysis.namespaces ?? []),
    calls: new Set(analysis.calls ?? []),
    types: new Set(analysis.types ?? []),
    declarations: new Map(analysis.declarations ?? []),
    symbols: analysis.symbols ?? [],
    symbolCalls: analysis.symbolCalls ?? [],
  };
}

const TS_CONFIG_NAMES = new Set(["tsconfig.json", "jsconfig.json"]);

/** Parse one file into serializable analysis (regex fallback when WASM is unavailable). */
export async function parseSourceFile(file: SourceFile): Promise<FileAnalysis> {
  const ext = extensionOf(file.path);
  const languageKey = EXTENSION_LANGUAGE[ext];
  const kind = kindOf(file.path);
  const loc = file.content.split("\n").length;
  const aliases = TS_CONFIG_NAMES.has(path.posix.basename(file.path))
    ? collectAliasConfig([file])
    : undefined;

  if (!languageKey) {
    return toFileAnalysis(
      {
        id: file.path,
        language: "javascript",
        imports: new Map(),
        namespaces: new Map(),
        calls: new Set(),
        types: new Set(),
        declarations: new Map(),
        symbols: [],
        symbolCalls: [],
      },
      file,
      kind,
      loc,
      aliases,
    );
  }

  let parsed: ParsedFile;
  try {
    const parsers = await getParsers();
    const tree = parsers.get(languageKey)!.parse(file.content);
    parsed = tree
      ? languageKey === "python"
        ? parsePythonFile(tree.rootNode, file.path)
        : parseTypeScriptFile(tree.rootNode, file.path, languageKey)
      : parseWithRegex(file);
  } catch {
    parsed = parseWithRegex(file);
  }

  return toFileAnalysis(parsed, file, kind, loc, aliases);
}

function pickSymbol(
  index: Map<string, CodeGraphSymbol[]>,
  name: string,
  fileId: string,
): CodeGraphSymbol | undefined {
  const candidates = index.get(name);
  if (!candidates || candidates.length === 0) return undefined;
  return (
    candidates.find((symbol) => symbol.fileId === fileId && symbol.exported) ??
    candidates.find((symbol) => symbol.fileId === fileId) ??
    (candidates.length === 1 ? candidates[0] : undefined)
  );
}

/** Build the file graph, connections and symbol graph from per-file analyses. */
export function buildAnalyzeResult(analyses: FileAnalysis[]): AnalyzeResult {
  const fileIds = new Set(analyses.map((analysis) => analysis.path));
  const aliases: AliasConfig = { rules: [], baseUrls: [] };
  for (const analysis of analyses) {
    if (!analysis.aliases) continue;
    aliases.rules.push(...analysis.aliases.rules);
    aliases.baseUrls.push(...analysis.aliases.baseUrls);
  }

  const graphFiles: CodeGraphFile[] = analyses.map((analysis) => createFile(analysis.path, analysis.loc));
  const parsedByPath = new Map<string, ParsedFile>();
  const globalSymbols = new Map<string, CodeGraphSymbol[]>();
  for (const analysis of analyses) {
    parsedByPath.set(analysis.path, fromFileAnalysis(analysis));
    for (const symbol of analysis.symbols) {
      const bucket = globalSymbols.get(symbol.name);
      if (bucket) bucket.push(symbol);
      else globalSymbols.set(symbol.name, [symbol]);
    }
  }

  const connections: CodeGraphConnection[] = [];
  const seen = new Set<string>();
  const degree = new Map<string, number>();
  const addConnection = (source: string, target: string, kind: ConnectionKind) => {
    if (source === target || !fileIds.has(target) || !fileIds.has(source)) return;
    const key = `${source}|${target}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    connections.push({ source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  };

  const symbolEdges: CodeGraphSymbolEdge[] = [];
  const seenSymbolEdges = new Set<string>();
  const addSymbolEdge = (source: string, target: string, kind: "calls" | "references") => {
    if (!source || !target || source === target || symbolEdges.length >= MAX_SYMBOL_EDGES) return;
    const key = `${source}|${target}`;
    if (seenSymbolEdges.has(key)) return;
    seenSymbolEdges.add(key);
    symbolEdges.push({ source, target, kind });
  };

  for (const analysis of analyses) {
    const parsed = parsedByPath.get(analysis.path)!;
    const resolvedImports = new Map<string, string>();

    for (const [name, specifier] of parsed.imports) {
      const target =
        parsed.language === "python"
          ? resolvePythonModule(parsed.id, specifier, fileIds)
          : resolveJsSpecifier(parsed.id, specifier, fileIds, aliases);
      if (target) {
        resolvedImports.set(name, target);
        addConnection(parsed.id, target, "imports");
      }
    }

    for (const [namespace, specifier] of parsed.namespaces) {
      const target =
        parsed.language === "python"
          ? resolvePythonModule(parsed.id, specifier, fileIds)
          : resolveJsSpecifier(parsed.id, specifier, fileIds, aliases);
      if (target) resolvedImports.set(namespace, target);
    }

    for (const call of parsed.calls) {
      let target = resolvedImports.get(call);
      if (!target && call.includes(".")) {
        const head = call.split(".")[0];
        if (parsed.namespaces.has(head)) target = resolvedImports.get(head);
      }
      if (!target) {
        const declared = parsed.declarations.get(call);
        if (declared) continue;
        const candidates = globalSymbols.get(call);
        if (candidates && new Set(candidates.map((symbol) => symbol.fileId)).size === 1) {
          target = candidates[0].fileId;
        }
      }
      if (target) addConnection(parsed.id, target, "calls");
      if (connections.length >= MAX_CONNECTIONS) break;
    }

    for (const typeName of parsed.types) {
      if (resolvedImports.has(typeName)) continue;
      const candidates = globalSymbols.get(typeName);
      if (candidates && new Set(candidates.map((symbol) => symbol.fileId)).size === 1) {
        const fileId = candidates[0].fileId;
        if (fileId !== parsed.id && (candidates[0].kind === "type" || candidates[0].kind === "class")) {
          addConnection(parsed.id, fileId, "types");
        }
      }
      if (connections.length >= MAX_CONNECTIONS) break;
    }

    // Symbol-level call edges power impact analysis (callers/callees).
    for (const symbolCall of parsed.symbolCalls) {
      const simpleName = symbolCall.name.includes(".")
        ? symbolCall.name.split(".").pop()!
        : symbolCall.name;
      const head = symbolCall.name.includes(".") ? symbolCall.name.split(".")[0] : null;
      let targetFile: string | undefined;
      if (head && parsed.namespaces.has(head)) {
        targetFile = resolvedImports.get(head);
      }
      if (!targetFile) {
        targetFile = resolvedImports.get(symbolCall.name) ?? resolvedImports.get(simpleName);
      }
      let targetSymbol = targetFile ? pickSymbol(globalSymbols, simpleName, targetFile) : undefined;
      if (!targetSymbol) {
        const candidates = globalSymbols.get(simpleName);
        if (candidates && new Set(candidates.map((symbol) => symbol.fileId)).size === 1) {
          targetSymbol = candidates[0];
        }
      }
      if (targetSymbol) addSymbolEdge(symbolCall.from, targetSymbol.id, symbolCall.kind);
    }
  }

  for (const file of graphFiles) {
    if ((degree.get(file.id) ?? 0) >= 8) file.hub = true;
  }

  return { files: graphFiles, connections, symbols: analyses.flatMap((a) => a.symbols), symbolEdges, parser: "tree-sitter" };
}

export async function analyzeSources(input: SourceFile[]): Promise<AnalyzeResult> {
  const analyses: FileAnalysis[] = [];
  for (const file of input) {
    analyses.push(await parseSourceFile(file));
  }
  return buildAnalyzeResult(analyses);
}

/** Files that are useful to show in the codebase map. */
export function isSupportedCodegraphFile(filePath: string): boolean {
  const ext = extensionOf(filePath);
  if (EXTENSION_LANGUAGE[ext]) return true;
  return ext in EXTENSION_LABELS || kindOf(filePath) !== "source";
}
