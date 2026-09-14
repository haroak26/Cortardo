import type { AgentKind, ChangedFile, Severity } from "../types";

export interface DetectorFinding {
  ruleId: string;
  agentKinds: AgentKind[];
  claim: string;
  severity: Severity;
  confidence: number;
  experiment: string;
  tags: string[];
  file: string;
  line: number;
  anchor: string;
  symbol?: string;
  fixData?: Record<string, string>;
}

export interface FixOutcome {
  content: string;
  description: string;
}

export type DiffSide = "added" | "removed" | "content";

export interface Detector {
  id: string;
  agentKinds: AgentKind[];
  severity: Severity;
  confidence: number;
  claim: string;
  experiment: string;
  tags: string[];
  provable?: boolean;
  matchLine?(line: string, file: ChangedFile, lineNumber: number, side: DiffSide): DetectorFinding | null;
  matchFile?(file: ChangedFile): DetectorFinding[];
  presentInContent?(content: string, finding: DetectorFinding): boolean;
  fix?(content: string, finding: DetectorFinding): FixOutcome | null;
}

const ROUTE_RE = /\b(?:app|router|server|api)\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(\s*["'`]/;
const AUTH_GUARD_RE =
  /(requireAuth|authenticate|isAuthenticated|authorize|withAuth|authMiddleware|verifyToken|requireUser|ensureAuth|checkAuth)/i;
const SENSITIVE_RE = /(admin|delete|remove|update|password|role|permission|billing|token|session|internal)/i;

function finding(
  detector: Detector,
  file: ChangedFile,
  line: number,
  anchor: string,
  fixData?: Record<string, string>,
): DetectorFinding {
  return {
    ruleId: detector.id,
    agentKinds: detector.agentKinds,
    claim: detector.claim,
    severity: detector.severity,
    confidence: detector.confidence,
    experiment: detector.experiment,
    tags: detector.tags,
    file: file.path,
    line,
    anchor,
    fixData,
  };
}

function compareOp(line: string): string | null {
  if (/[=!]==/.test(line)) return null;
  const match = /(^|[^=!<>])(==|!=)(?!=)/.exec(line);
  return match ? match[2] : null;
}

function replaceFirst(text: string, search: string, replacement: string): string {
  const index = text.indexOf(search);
  if (index === -1) return text;
  return text.slice(0, index) + replacement + text.slice(index + search.length);
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIndex; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function toEnvName(variableName: string): string {
  return variableName
    .replace(/^[^A-Za-z]*/, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toUpperCase();
}

const authWeakComparison: Detector = {
  id: "auth-weak-comparison",
  agentKinds: ["auth", "security", "bug"],
  severity: "high",
  confidence: 0.86,
  claim: "Authorization check uses a loose equality operator, which can be bypassed by type coercion",
  experiment: "Call the guarded endpoint with a coerced id (for example the string form of another user's id) and check for cross-account access",
  tags: ["auth", "comparison", "bypass"],
  matchLine(line, file, lineNumber, side) {
    if (side === "content" && /process\.env|typeof|^\s*\/\//.test(line)) return null;
    const op = compareOp(line);
    if (!op) return null;
    if (!/(auth|token|password|secret|session|user|role|admin|owner|permission|login)/i.test(line)) return null;
    if (!/(if|return|&&|\|\||while|\?|=>)/.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => compareOp(line) !== null && line.includes(f.anchor.trim()));
  },
  fix(content, f) {
    const op = compareOp(f.anchor);
    if (!op) return null;
    const fixedAnchor = op === "==" ? f.anchor.replace("==", "===") : f.anchor.replace("!=", "!==");
    if (fixedAnchor === f.anchor) return null;
    return {
      content: replaceFirst(content, f.anchor, fixedAnchor),
      description: `Use strict ${op === "==" ? "===" : "!=="} for the authorization comparison`,
    };
  },
};

const authMissingCheck: Detector = {
  id: "auth-missing-check",
  agentKinds: ["auth", "security"],
  severity: "high",
  confidence: 0.82,
  claim: "A sensitive route handler is registered without an authentication or authorization guard",
  experiment: "Send an unauthenticated request to the route and verify it is rejected with 401/403",
  tags: ["auth", "route", "missing-guard"],
  matchFile(file) {
    const globalGuard = file.addedLines.some((line) =>
      /\b(?:app|router|server)\s*\.\s*use\s*\(\s*(requireAuth|authenticate|withAuth|authMiddleware|verifyToken|isAuthenticated)/.test(
        line.text,
      ),
    );
    if (globalGuard) return [];
    return file.addedLines
      .filter((line) => ROUTE_RE.test(line.text) && SENSITIVE_RE.test(line.text) && !AUTH_GUARD_RE.test(line.text))
      .map((line) => finding(this, file, line.line, line.text));
  },
  presentInContent(content, f) {
    const lines = content.split("\n");
    const route = lines.find(
      (line) => ROUTE_RE.test(line) && SENSITIVE_RE.test(line) && line.includes(extractRoutePath(f.anchor)),
    );
    if (!route) return false;
    return !AUTH_GUARD_RE.test(route);
  },
  fix(content, f) {
    const line = f.anchor.replace(/\s+$/, "");
    const fixed = line.replace(/,\s*([A-Za-z_$][\w$]*)\s*\)\s*;?\s*$/, ", requireAuth, $1);");
    if (fixed === line) return null;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: "Require authentication before the sensitive route handler runs",
    };
  },
};

function extractRoutePath(line: string): string {
  const match = /["'`]([^"'`]+)["'`]/.exec(line);
  return match ? match[1] : "";
}

const sqlInjection: Detector = {
  id: "sql-injection",
  agentKinds: ["database", "security", "api"],
  severity: "critical",
  confidence: 0.9,
  claim: "SQL statement is assembled with string interpolation, allowing injection through request data",
  experiment: "Send a payload containing a quote and boolean tautology to the query input and observe the altered result set",
  tags: ["database", "injection", "owasp"],
  matchLine(line, file, lineNumber, side) {
    if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) return null;
    if (!/(query|execute|raw|sql|prepare|from\()/i.test(line)) return null;
    const params = [...line.matchAll(/\$\{([^}]+)\}/g)].map((match) => match[1]);
    if (params.length === 0) return null;
    return finding(this, file, lineNumber, line, { params: params.join("||") });
  },
  presentInContent(content, f) {
    const params = (f.fixData?.params ?? "").split("||").filter(Boolean);
    return content.split("\n").some((line) => {
      if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line)) return false;
      if (!/\$\{/.test(line)) return false;
      return params.some((name) => line.includes(`\${${name}}`)) || /\$\{[^}]+\}/.test(line);
    });
  },
  fix(content, f) {
    const params = (f.fixData?.params ?? "").split("||").filter(Boolean);
    if (params.length === 0) return null;
    const anchor = f.anchor;
    const callIndex = /(query|execute|raw|sql|prepare)\s*\(/i.exec(anchor);
    if (!callIndex) return null;
    const openIndex = anchor.indexOf("(", callIndex.index);
    const closeIndex = findMatchingParen(anchor, openIndex);
    if (closeIndex === -1) return null;
    let fixedLine = anchor.replace(/\$\{[^}]+\}/g, "?");
    if (!fixedLine.includes("?") || fixedLine.includes("${")) return null;
    let paramsList: string;
    if (/\[\s*\]/.test(anchor.slice(openIndex, closeIndex))) {
      paramsList = `[${params.join(", ")}]`;
    } else {
      paramsList = `[${params.join(", ")}]`;
    }
    const insertion = `, ${paramsList}`;
    fixedLine = fixedLine.slice(0, closeIndex) + insertion + fixedLine.slice(closeIndex);
    return {
      content: replaceFirst(content, f.anchor, fixedLine),
      description: `Parameterize the SQL statement instead of interpolating ${params.join(", ")}`,
    };
  },
};

const xss: Detector = {
  id: "xss-unsafe-html",
  agentKinds: ["ui", "security", "bug"],
  severity: "high",
  confidence: 0.88,
  claim: "Untrusted content is written into the DOM as raw HTML, enabling script injection",
  experiment: "Post a comment containing an img onerror payload and confirm script execution",
  tags: ["ui", "xss", "dom"],
  matchLine(line, file, lineNumber) {
    if (!/\.innerHTML\s*=/.test(line)) return null;
    if (/(escapeHtml|sanitize|DOMPurify|trustedTypes)/i.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => line.includes(f.anchor.trim()) && /\.innerHTML\s*=/.test(line));
  },
  fix(content, f) {
    const fixed = f.anchor.replace(/\.innerHTML\s*=/, ".textContent =");
    if (fixed === f.anchor) return null;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: "Render untrusted content as text instead of HTML",
    };
  },
};

const hardcodedSecret: Detector = {
  id: "hardcoded-secret",
  agentKinds: ["security", "config", "auth"],
  severity: "critical",
  confidence: 0.93,
  claim: "A credential is committed as a literal secret in source code",
  experiment: "Search the repository history for the literal value and rotate the credential",
  tags: ["security", "secret", "config"],
  matchLine(line, file, lineNumber) {
    if (/process\.env|import\.meta\.env|placeholder|example|changeme|xxxx|<.*>/i.test(line)) return null;
    const match =
      /(?:const|let|var|export\s+const)?\s*([A-Za-z_$][\w$]*)\s*[:=]\s*["'`]([A-Za-z0-9_\-./+]{12,})["'`]/.exec(
        line,
      );
    if (!match) return null;
    if (!/(api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key)/i.test(match[1])) return null;
    return finding(this, file, lineNumber, line, { variable: match[1], value: match[2] });
  },
  presentInContent(content, f) {
    const variable = f.fixData?.variable ?? "";
    return content.split("\n").some((line) => new RegExp(`\\b${escapeForRegExp(variable)}\\b`).test(line) && /["'`][A-Za-z0-9_\-./+]{12,}["'`]/.test(line) && !/process\.env/.test(line));
  },
  fix(content, f) {
    const variable = f.fixData?.variable;
    const value = f.fixData?.value;
    if (!variable || !value) return null;
    const envName = toEnvName(variable);
    const replacement = `process.env.${envName} ?? ""`;
    const fixed = f.anchor.replace(new RegExp(`(["'\`])${escapeForRegExp(value)}\\1`), replacement);
    if (fixed === f.anchor) return null;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: `Read ${variable} from process.env.${envName} instead of committing the literal value`,
    };
  },
};

const offByOne: Detector = {
  id: "off-by-one-loop",
  agentKinds: ["bug", "runtime"],
  severity: "medium",
  confidence: 0.8,
  claim: "Loop bound uses <= against length, reading one element past the end of the collection",
  experiment: "Run the loop against a short input and observe the out-of-range access",
  tags: ["bug", "loop", "bounds"],
  matchLine(line, file, lineNumber) {
    if (!/for\s*\(/.test(line)) return null;
    if (!/<=\s*[A-Za-z_$][\w$.[\]]*\.length\b/.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => line.includes(f.anchor.trim()));
  },
  fix(content, f) {
    const fixed = f.anchor.replace(/<=\s*([A-Za-z_$][\w$.[\]]*\.length)/, "< $1");
    if (fixed === f.anchor) return null;
    return { content: replaceFirst(content, f.anchor, fixed), description: "Use a strict < loop bound" };
  },
};

const unhandledAsync: Detector = {
  id: "unhandled-async-rejection",
  agentKinds: ["bug", "runtime", "api"],
  severity: "medium",
  confidence: 0.72,
  claim: "A promise chain has no rejection handler, so failures become unhandled rejections at runtime",
  experiment: "Force the underlying call to reject and observe the unhandled rejection",
  tags: ["async", "runtime", "reliability"],
  matchLine(line, file, lineNumber) {
    if (!/\.then\s*\(/.test(line)) return null;
    if (/\.catch\s*\(|\.finally\s*\(|await\s/.test(line)) return null;
    if (/^\s*(\/\/|\*)/.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => line.includes(f.anchor.trim()) && !/\.catch\s*\(/.test(line));
  },
  fix(content, f) {
    const thenIndex = f.anchor.search(/\.then\s*\(/);
    if (thenIndex === -1) return null;
    const openIndex = f.anchor.indexOf("(", thenIndex);
    const closeIndex = findMatchingParen(f.anchor, openIndex);
    if (closeIndex === -1) return null;
    const fixed =
      f.anchor.slice(0, closeIndex + 1) +
      `.catch((error) => { console.error(error); })` +
      f.anchor.slice(closeIndex + 1);
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: "Attach a rejection handler to the promise chain",
    };
  },
};

const sequentialAwaitMap: Detector = {
  id: "sequential-await-map",
  agentKinds: ["performance", "database"],
  severity: "medium",
  confidence: 0.75,
  claim: "Independent async work inside map runs sequentially instead of concurrently",
  experiment: "Load the endpoint with many ids and compare wall-clock time against a batched implementation",
  tags: ["performance", "async", "n+1"],
  matchLine(line, file, lineNumber) {
    if (!/\.map\s*\(\s*async\b/.test(line)) return null;
    if (/Promise\.all/.test(line)) return null;
    if (!/await\s/.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => line.includes(f.anchor.trim()) && /\.map\s*\(\s*async\b/.test(line) && !/Promise\.all/.test(line));
  },
  fix(content, f) {
    if (/Promise\.all/.test(f.anchor)) return null;
    const mapIndex = f.anchor.search(/\.map\s*\(/);
    const eqIndex = f.anchor.lastIndexOf("=", mapIndex);
    if (mapIndex === -1 || eqIndex === -1) return null;
    const exprStart = eqIndex + 1;
    const before = f.anchor.slice(0, exprStart);
    const expression = f.anchor.slice(exprStart).replace(/;\s*$/, "");
    const semicolon = /;\s*$/.test(f.anchor) ? ";" : "";
    const fixed = `${before} await Promise.all(${expression.trim()})${semicolon}`;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: "Run independent async work concurrently with Promise.all",
    };
  },
};

const API_SIGNATURE_RE = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/;

function parseParams(paramText: string): string[] {
  return paramText
    .split(",")
    .map((param) => param.trim())
    .filter((param) => param.length > 0);
}

function paramName(param: string): string {
  const [name] = param.split(/[:=?]/);
  return name.trim();
}

const apiBreakingChange: Detector = {
  id: "api-breaking-signature",
  agentKinds: ["api", "regression", "bug"],
  severity: "high",
  confidence: 0.78,
  claim: "An exported function signature lost a parameter, breaking existing callers",
  experiment: "Type-check the repository to surface call sites that still pass the removed argument",
  tags: ["api", "breaking", "contract"],
  matchFile(file) {
    const removed = new Map<string, { params: string[]; line: number; text: string }>();
    for (const line of file.removedLines) {
      const match = API_SIGNATURE_RE.exec(line.text);
      if (match) removed.set(match[1], { params: parseParams(match[2]), line: line.line, text: line.text });
    }
    const findings: DetectorFinding[] = [];
    for (const line of file.addedLines) {
      const match = API_SIGNATURE_RE.exec(line.text);
      if (!match) continue;
      const previous = removed.get(match[1]);
      if (!previous) continue;
      const nextParams = parseParams(match[2]);
      if (nextParams.length >= previous.params.length) continue;
      const missing = previous.params.slice(nextParams.length);
      findings.push(
        finding(this, file, line.line, line.text, {
          missing: missing.join("||"),
        }),
      );
    }
    return findings;
  },
  presentInContent(content, f) {
    const missing = (f.fixData?.missing ?? "").split("||").filter(Boolean);
    if (missing.length === 0) return false;
    const lines = content.split("\n");
    const current = lines.find((line) => line.includes(f.anchor.trim()));
    if (!current) return false;
    return missing.some((param) => !current.includes(paramName(param)));
  },
  fix(content, f) {
    const missing = (f.fixData?.missing ?? "").split("||").filter(Boolean);
    if (missing.length === 0) return null;
    const match = API_SIGNATURE_RE.exec(f.anchor);
    if (!match) return null;
    const closeIndex = f.anchor.indexOf(")", match.index);
    if (closeIndex === -1) return null;
    const optionalParams = missing.map((param) => {
      const name = paramName(param);
      const typeMatch = /:\s*([^=,]+)/.exec(param);
      if (/[?]/.test(name)) return param;
      return typeMatch ? `${name}?: ${typeMatch[1].trim()}` : `${name}?`;
    });
    const before = f.anchor.slice(0, closeIndex);
    const needsComma = before.trim().length > 0 && !before.trim().endsWith(",");
    const fixed = `${before}${needsComma ? ", " : ""}${optionalParams.join(", ")}${f.anchor.slice(closeIndex)}`;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: `Restore the removed parameter${missing.length > 1 ? "s" : ""} as optional for backward compatibility`,
    };
  },
};

const removedTest: Detector = {
  id: "removed-test-coverage",
  agentKinds: ["regression"],
  severity: "medium",
  confidence: 0.7,
  provable: false,
  claim: "The change deletes test assertions without replacing them, removing regression protection",
  experiment: "Run the previous test suite against the new code and check which assertions no longer execute",
  tags: ["tests", "regression", "coverage"],
  matchLine(line, file, lineNumber, side) {
    if (side !== "removed") return null;
    if (!/(expect\s*\(|assert[.(]|\.toBe|\.toEqual|\.toThrow|describe\s*\(|it\s*\(|test\s*\()/.test(line)) return null;
    if (!/(\.(test|spec)\.|__tests__|tests?\/)/.test(file.path)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return !content.split("\n").some((line) => line.trim() === f.anchor.trim());
  },
  fix(content, f) {
    if (content.includes(f.anchor)) return null;
    const lines = content.split("\n");
    let insertAt = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() === "}" || lines[i].trim() === "});") {
        insertAt = i;
        break;
      }
    }
    const next = [...lines.slice(0, insertAt), f.anchor, ...lines.slice(insertAt)];
    return { content: next.join("\n"), description: "Restore the deleted test assertion" };
  },
};

const configInsecureDefault: Detector = {
  id: "config-insecure-default",
  agentKinds: ["config", "security"],
  severity: "medium",
  confidence: 0.76,
  provable: false,
  claim: "Security-relevant configuration falls back to an insecure literal default",
  experiment: "Start the service without the environment variable set and confirm it accepts the fallback value",
  tags: ["config", "fallback", "security"],
  matchLine(line, file, lineNumber) {
    if (!/process\.env\.[A-Z0-9_]+\s*(\|\||\?\?)\s*["'`][^"'`]+["'`]/.test(line)) return null;
    if (!/(secret|key|token|password|auth|session|cookie|admin)/i.test(line)) return null;
    return finding(this, file, lineNumber, line);
  },
  presentInContent(content, f) {
    return content.split("\n").some((line) => line.includes(f.anchor.trim()));
  },
  fix(content, f) {
    const fixed = f.anchor.replace(/(process\.env\.[A-Z0-9_]+)\s*(\|\||\?\?)\s*["'`][^"'`]+["'`]/, "$1 ?? \"\"");
    if (fixed === f.anchor) return null;
    return {
      content: replaceFirst(content, f.anchor, fixed),
      description: "Remove the insecure literal fallback and fail closed",
    };
  },
};

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const DETECTORS: Detector[] = [
  authWeakComparison,
  authMissingCheck,
  sqlInjection,
  xss,
  hardcodedSecret,
  offByOne,
  unhandledAsync,
  sequentialAwaitMap,
  apiBreakingChange,
  removedTest,
  configInsecureDefault,
];

export function detectorById(id: string): Detector | undefined {
  return DETECTORS.find((detector) => detector.id === id);
}

export function detectForFiles(
  files: ChangedFile[],
  agentKinds: AgentKind[],
  limit = 2,
): DetectorFinding[] {
  const wanted = new Set(agentKinds);
  const findings: DetectorFinding[] = [];
  for (const detector of DETECTORS) {
    if (!detector.agentKinds.some((kind) => wanted.has(kind))) continue;
    for (const file of files) {
      if (file.status === "removed") continue;
      const matches: DetectorFinding[] = [];
      if (detector.matchFile) {
        matches.push(...detector.matchFile(file));
      }
      if (detector.matchLine) {
        for (const line of file.addedLines) {
          const match = detector.matchLine(line.text, file, line.line, "added");
          if (match) matches.push(match);
        }
        for (const line of file.removedLines) {
          const match = detector.matchLine(line.text, file, line.line, "removed");
          if (match) matches.push(match);
        }
      }
      findings.push(...matches);
    }
  }
  findings.sort((a, b) => severityScore(b.severity) * b.confidence - severityScore(a.severity) * a.confidence);
  return findings.slice(0, limit);
}

export function detectorPresentInContent(
  ruleId: string,
  content: string,
  finding: DetectorFinding,
): boolean {
  const detector = detectorById(ruleId);
  if (!detector?.presentInContent) return false;
  return detector.presentInContent(content, finding);
}

export function detectorFix(
  ruleId: string,
  content: string,
  finding: DetectorFinding,
): FixOutcome | null {
  const detector = detectorById(ruleId);
  if (!detector?.fix) return null;
  return detector.fix(content, finding);
}

export function severityScore(severity: Severity): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity];
}
