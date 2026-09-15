import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import type {
  BrowserCheck,
  BrowserCheckResult,
  Candidate,
  ContextPack,
  ModelClient,
  ModelTask,
  PRContext,
  ProofResult,
} from "../../src/v3/types.ts";
import { hashContent } from "../../src/v3/util.ts";

export const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

export interface ScriptedClient extends ModelClient {
  calls: ModelTask[];
}

export function scriptedClient(role: "luna" | "terra" | "astra", handler: (task: ModelTask, index: number) => string): ScriptedClient {
  const calls: ModelTask[] = [];
  return {
    id: `scripted-${role}`,
    calls,
    async complete(task: ModelTask) {
      calls.push(task);
      return { text: handler(task, calls.length - 1), model: `scripted-${role}`, tokensIn: 5, tokensOut: 5, durationMs: 0 };
    },
  };
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "c_test01",
    claim: "the file assigns undefined and dereferences it",
    severity: "high",
    confidence: 0.9,
    file: "src/a.ts",
    line: 2,
    evidence: ["src/a.ts:1", "src/a.ts:2"],
    source: "detector",
    agentKind: "runtime",
    suggestedProof: "browser",
    tags: ["test"],
    occurrences: 1,
    score: 5,
    mergedFrom: [],
    ...overrides,
  };
}

export function contextWith(files: Array<{ path: string; content: string; hunks?: PRContext["files"][number]["hunks"] }>, extras: Partial<PRContext> = {}): PRContext {
  return {
    id: "run-test",
    title: "Test PR",
    body: "",
    files: files.map((file) => ({
      path: file.path,
      status: "modified" as const,
      language: "TypeScript",
      additions: 1,
      deletions: 1,
      hunks: file.hunks ?? [],
      addedLines: [],
      removedLines: [],
      content: file.content,
      lines: file.content.split("\n"),
    })),
    additions: 1,
    deletions: 1,
    classification: ["UI"],
    size: "normal",
    symbols: [],
    routes: [],
    tests: [],
    riskSignals: [],
    pages: [],
    packageManager: "npm",
    hasTests: true,
    hasTypecheck: true,
    hasBuild: false,
    ...extras,
  };
}

export function packFor(candidateValue: Candidate, files: Array<{ path: string; content: string }>): ContextPack {
  return {
    candidateId: candidateValue.id,
    files: files.map((file) => ({ path: file.path, content: file.content, numbered: file.content, hash: hashContent(file.content), changed: file.path === candidateValue.file })),
    imports: [],
    symbols: [],
    tests: [],
    routes: [],
    diff: "",
    reproduction: "assertion failed (expected pass)",
    check: candidateValue.check,
    detectorEvidence: candidateValue.evidence,
    hash: hashContent(files.map((file) => `${file.path}:${file.content}`).join("|")),
  };
}

export function proof(candidateValue: Candidate, status: ProofResult["status"] = "confirmed"): ProofResult {
  return {
    candidateId: candidateValue.id,
    status,
    strategy: status === "confirmed" ? "browser" : "none",
    attempts: [],
    reproduction: `${candidateValue.file}: assertion failed (expected pass)`,
    explanation: status === "confirmed" ? "Reproduced in a real browser" : "not reproduced",
    durationMs: 1,
  };
}

export interface HarnessSandbox extends MemorySandbox {
  filesSnapshot(): Promise<Record<string, string>>;
}

/** MemorySandbox that reflects edits so a proof function can inspect content. */
export function contentSandbox(files: Record<string, string>): MemorySandbox {
  return new MemorySandbox({
    files,
    profile: { typecheckCommand: "npm run check --silent" },
    execHandler: (command) => ({ exitCode: command.includes("check") ? 0 : 0, stdout: "ok" }),
  });
}

/** A proveCandidate function driven by file content predicates. */
export function contentProof(sandbox: MemorySandbox, file: string, defect: (content: string) => boolean) {
  return async (candidateValue: Candidate): Promise<ProofResult> => {
    const content = await sandbox.read(file).catch(() => "");
    const present = defect(content);
    return {
      candidateId: candidateValue.id,
      status: present ? "confirmed" : "disproven",
      strategy: "browser",
      attempts: [],
      reproduction: present ? "assertion failed (expected pass)" : "assertion passed",
      explanation: present ? "defect still present" : "reproduction passes twice on a fresh boot",
      durationMs: 1,
    };
  };
}

export function browserCheck(path: string, value: string): BrowserCheck {
  return { path, assert: { type: "textContains", value }, expected: "pass", label: `page must contain "${value}"` };
}

export function checkResult(id: string, path: string, passed: boolean, detail = passed ? "assertion passed" : "assertion failed"): BrowserCheckResult {
  return { id, path, passed, pageErrors: [], consoleErrors: [], detail, durationMs: 1 };
}
