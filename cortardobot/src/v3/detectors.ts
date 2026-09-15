import type { BrowserCheck, Candidate, ParsedFile, PRContext } from "./types";
import { routeForPage } from "./intelligence";

function stableId(prefix: string, ...parts: string[]): string {
  let hash = 0;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function evidenceFor(file: ParsedFile, line: number): string[] {
  return [`${file.path}:${line}`];
}

function pageCheck(file: ParsedFile, assert: BrowserCheck["assert"], label: string, clickText?: string): BrowserCheck | undefined {
  const route = routeForPage(file.path);
  if (!route) return undefined;
  return { path: route, clickText, assert, expected: "pass", label };
}

function buttonTextNear(lines: string[], startIndex: number, maxLines = 14): string | undefined {
  for (let i = startIndex; i <= startIndex + maxLines && i < lines.length; i++) {
    const text = lines[i];
    if (i > startIndex && /<(Button|button|a|Link)\b/.test(text)) break;
    const inline = />\s*([A-Z][A-Za-z0-9 '/&.-]{2,32}?)\s*</.exec(text);
    if (inline && !/^(Mail|Arrow|Check|Zap|Sparkles|Building|Copy|Terminal)$/.test(inline[1].trim())) {
      return inline[1].trim();
    }
    const jsxText = /^\s+([A-Z][A-Za-z0-9 '/&.-]{2,32}?)\s*$/.exec(text);
    if (jsxText && !/^[A-Z_]+$/.test(jsxText[1].trim()) && !/(icon|className|return)/i.test(jsxText[1])) {
      return jsxText[1].trim();
    }
  }
  return undefined;
}

function firstContentLine(file: ParsedFile | undefined, pattern: RegExp): number | undefined {
  if (!file?.lines) return undefined;
  const index = file.lines.findIndex((line) => pattern.test(line));
  return index >= 0 ? index + 1 : undefined;
}

export function runDetectors(context: PRContext): Candidate[] {
  const candidates: Candidate[] = [];
  const byPath = new Map(context.files.map((file) => [file.path, file]));

  for (const file of context.files) {
    if (!file.lines) continue;
    const lines = file.lines;

    // 1. Explicitly-undefined value dereferenced during render / request handling.
    for (const added of file.addedLines) {
      const line = added.newLine;
      const text = added.text;
      if (line === undefined) continue;
      const decl = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(undefined\b|void 0\b)/.exec(text);
      if (!decl) continue;
      const name = decl[1];
      const accessRe = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\s*\\.\\s*[A-Za-z_$]`);
      let derefLine: number | undefined;
      for (let i = line; i <= Math.min(line + 4, lines.length); i++) {
        const actual = lines[i - 1] ?? "";
        if (i !== line && /^\s*(?:const|let|var)\s+/.test(actual)) break;
        if (accessRe.test(actual)) {
          derefLine = i;
          break;
        }
      }
      if (derefLine === undefined) continue;
      const renderedCrash = /^(?:export\s+default\s+)?(?:function|const)\s+[A-Z]/.test(lines.map((l) => l).join("\n").slice(0, lines.slice(0, 200).join("\n").length + 1));
      const check = pageCheck(file, { type: "noPageError" }, "page must render without a TypeError", undefined);
      candidates.push({
        id: stableId("c", file.path, String(line), "undefined-deref"),
        claim: `${file.path}:${line} declares \`${name}\` as explicitly undefined and then reads \`${name}.property...\` at line ${derefLine} during render, which throws a TypeError and breaks the page.`,
        severity: "critical",
        confidence: 0.96,
        file: file.path,
        line: derefLine,
        endLine: derefLine,
        evidence: [...evidenceFor(file, line), ...evidenceFor(file, derefLine)],
        source: "detector",
        agentKind: "runtime",
        suggestedProof: check ? "browser" : "none",
        check,
        autoFix: [
          {
            path: file.path,
            find: lines.slice(line - 1, derefLine).join("\n"),
            replace: "",
          },
        ],
        tags: ["undefined-deref", "crash", renderedCrash ? "render" : "code"],
        occurrences: 1,
        score: 9,
        mergedFrom: [],
      });
    }

    // 2. Array filtered by index while the file still defines the excluded featured item.
    for (const added of file.addedLines) {
      const line = added.newLine;
      if (line === undefined) continue;
      const filter = /\.filter\s*\(\s*\(\s*_?\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*=>\s*\1\s*!==\s*(\d+)\s*\)/.exec(added.text);
      if (!filter) continue;
      const excluded = Number(filter[2]);
      const hasPopular = lines.some((l) => /popular\s*:\s*true/.test(l));
      const hasBadge = lines.some((l) => /Most Popular/.test(l));
      if (!hasPopular && !hasBadge) continue;
      const names = [...lines.join("\n").matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
      const excludedName = names[excluded];
      const check = hasBadge
        ? pageCheck(file, { type: "textContains", value: "Most Popular" }, "featured plan must render", undefined)
        : undefined;
      candidates.push({
        id: stableId("c", file.path, String(line), "index-filter"),
        claim: `${file.path}:${line} filters out array index ${excluded}${excludedName ? ` (\`${excludedName}\`)` : ""} from the rendered list while the same page still presents it as the featured tier (e.g. comparison table). The ${excludedName ?? "featured"} plan disappears from the page.`,
        severity: "high",
        confidence: 0.86,
        file: file.path,
        line,
        endLine: line,
        evidence: [...evidenceFor(file, line), ...evidenceFor(file, firstContentLine(file, /popular\s*:\s*true/) ?? line)],
        source: "detector",
        agentKind: "ui",
        suggestedProof: check ? "browser" : "none",
        check,
        autoFix: [
          {
            path: file.path,
            find: added.text,
            replace: added.text.replace(/\.filter\s*\(\s*\(\s*_?\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*=>\s*[A-Za-z_$][\w$]*\s*!==\s*\d+\s*\)/, ""),
          },
        ],
        tags: ["index-filter", "featured-item-removed"],
        occurrences: 1,
        score: 8,
        mergedFrom: [],
      });
    }

    // 3. Navigation target intentionally changed to "/" while a specific destination was removed,
    //    e.g. a registration button that now dumps users on the landing page. Only pairs that are
    //    adjacent within the same diff hunk are considered, so unrelated removals/additions never pair.
    const NAV_RE = /(setLocation|navigate|router\.push|href=)\s*\(?\s*["'`]([^"'`]+)["'`]/;
    for (const hunk of file.hunks) {
      const removedNav: Array<{ position: number; call: string; target: string; text: string; line: number }> = [];
      const addedNav: Array<{ position: number; call: string; target: string; text: string; line: number }> = [];
      hunk.lines.forEach((line, position) => {
        const match = NAV_RE.exec(line.text);
        if (!match) return;
        if (line.type === "-" && line.oldLine !== undefined) {
          removedNav.push({ position, call: match[1], target: match[2], text: line.text, line: line.oldLine });
        } else if (line.type === "+" && line.newLine !== undefined) {
          addedNav.push({ position, call: match[1], target: match[2], text: line.text, line: line.newLine });
        }
      });
      for (const added of addedNav) {
        if (added.target !== "/") continue;
        const changedFrom = removedNav
          .filter((removed) => removed.call === added.call && removed.target !== added.target && removed.position < added.position)
          .sort((a, b) => b.position - a.position)[0];
        if (!changedFrom) continue;
        const route = routeForPage(file.path);
        const clickText = route ? buttonTextNear(lines, added.line - 1) : undefined;
        const check =
          route && clickText
            ? {
                path: route,
                clickText,
                assert: { type: "pathEquals" as const, value: changedFrom.target },
                expected: "pass" as const,
                label: `clicking "${clickText}" must navigate to ${changedFrom.target}`,
              }
            : undefined;
        candidates.push({
          id: stableId("c", file.path, String(added.line), "nav-regression"),
          claim: `${file.path}:${added.line} changes the ${added.call} target from \`${changedFrom.target}\` to \`${added.target}\`, so the "${clickText ?? added.call}" action sends users to the landing page instead of \`${changedFrom.target}\`.`,
          severity: "high",
          confidence: 0.84,
          file: file.path,
          line: added.line,
          endLine: added.line,
          evidence: [...evidenceFor(file, changedFrom.line), ...evidenceFor(file, added.line)],
          source: "detector",
          agentKind: "ui",
          suggestedProof: check ? "browser" : "none",
          check,
          autoFix: [
            {
              path: file.path,
              find: added.text,
              replace: added.text
                .replace(`"${added.target}"`, `"${changedFrom.target}"`)
                .replace(`'${added.target}'`, `'${changedFrom.target}'`)
                .replace(`\`${added.target}\``, `\`${changedFrom.target}\``),
            },
          ],
          tags: ["nav-regression", "wrong-page"],
          occurrences: 1,
          score: 8,
          mergedFrom: [],
        });
      }
    }

    // 4. Gradient text missing text-transparent (cosmetic, static only).
    let tagBuffer: string[] = [];
    for (const added of file.addedLines) {
      if (added.newLine === undefined) continue;
      const line = added.newLine;
      const window = [
        lines[line - 2] ?? "",
        lines[line - 1] ?? "",
        lines[line] ?? "",
      ].join(" ");
      if (/bg-clip-text/.test(added.text) && !/text-transparent/.test(window) && /gradient/.test(window)) {
        candidates.push({
          id: stableId("c", file.path, String(line), "gradient-clip"),
          claim: `${file.path}:${line} applies bg-clip-text with a gradient but omits text-transparent, so the opaque foreground color paints over the clipped gradient and the gradient heading renders flat.`,
          severity: "low",
          confidence: 0.75,
          file: file.path,
          line,
          endLine: line,
          evidence: evidenceFor(file, line),
          source: "detector",
          agentKind: "ui",
          suggestedProof: "none",
          tags: ["gradient-clip", "cosmetic"],
          occurrences: 1,
          score: 3,
          mergedFrom: [],
        });
      }
      tagBuffer = [];
    }

    // 5. Unsanitized redirect parameter on auth links/handlers.
    for (const added of file.addedLines) {
      if (added.newLine === undefined) continue;
      const value = /(redirect|returnTo|next)\s*=\s*\{?\s*([A-Za-z_$][\w$]*|search\.get\([^)]*\)|window\.location[^}\s]*)/.exec(added.text);
      if (!value || /["'`]/.test(added.text.slice(value.index, value.index + 8))) continue;
      const href = /(href|location\.href)\s*=/.test(added.text) || /\/auth\//.test(added.text);
      if (!href) continue;
      candidates.push({
        id: stableId("c", file.path, String(added.newLine), "open-redirect"),
        claim: `${file.path}:${added.newLine} forwards a user-controlled \`${value[1]}\` value into an auth link/redirect without validating that it is a same-origin relative path, enabling an open-redirect/phishing vector after login.`,
        severity: "medium",
        confidence: 0.45,
        file: file.path,
        line: added.newLine,
        evidence: evidenceFor(file, added.newLine),
        source: "detector",
        agentKind: "security",
        suggestedProof: "none",
        tags: ["open-redirect", "auth"],
        occurrences: 1,
        score: 4,
        mergedFrom: [],
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function dedupeAgainstDetectors(candidates: Candidate[], detectors: Candidate[]): Candidate[] {
  return candidates.filter((candidate) => {
    if (!candidate.file || candidate.line === undefined) return true;
    return !detectors.some(
      (detector) =>
        detector.file === candidate.file &&
        detector.line !== undefined &&
        Math.abs(detector.line - candidate.line!) <= 4,
    );
  });
}
