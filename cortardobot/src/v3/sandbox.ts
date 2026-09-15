import type { ApplyResult, BrowserCheck, BrowserCheckResult, ExecResult, RepairEdit } from "./types";

export interface RepoProfile {
  packageManager: "npm" | "pnpm" | "yarn";
  installCommand: string;
  hasNodeModules: boolean;
  hasTests: boolean;
  testCommand?: string;
  testSingle?: (file: string) => string;
  typecheckCommand?: string;
  buildCommand?: string;
  devCommand?: string;
  scripts: Record<string, string>;
}

export interface Sandbox {
  readonly id: string;
  readonly root: string;
  prepare(options: { cloneUrl: string; token: string; ref: string; headBranch?: string }): Promise<void>;
  install(): Promise<void>;
  profile(): Promise<RepoProfile>;
  exec(command: string, options?: { cwd?: string; timeoutMs?: number; allowFailure?: boolean }): Promise<ExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir?: string): Promise<string[]>;
  applyEdits(edits: RepairEdit[]): Promise<ApplyResult>;
  gitDiff(): Promise<string>;
  startApp(options?: { port?: number; command?: string; readyPath?: string }): Promise<{ url: string; stop: () => Promise<void> }>;
  browserChecks(checks: Array<{ id: string; check: BrowserCheck }>, baseUrl: string): Promise<BrowserCheckResult[]>;
  cleanup(): Promise<void>;
}

export function buildBrowserScript(): string {
  return `const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const baseUrl = input.baseUrl;
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const results = [];
  for (const entry of input.checks) {
    const check = entry.check;
    const started = Date.now();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error && error.stack ? error.stack : error)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    let passed = false;
    let detail = "";
    try {
      await page.goto(baseUrl + check.path, { waitUntil: "load", timeout: 45000 });
      await page.waitForTimeout(1800);
      if (check.clickText) {
        await page.getByText(check.clickText, { exact: false }).first().click({ timeout: 15000 });
        await page.waitForTimeout(1200);
      }
      let assertionPassed = false;
      if (check.assert.type === "noPageError") {
        assertionPassed = pageErrors.length === 0;
      } else if (check.assert.type === "pathEquals") {
        assertionPassed = new URL(page.url()).pathname === check.assert.value;
      } else if (check.assert.type === "textContains") {
        const body = (await page.locator("body").innerText({ timeout: 15000 })).toLowerCase();
        assertionPassed = body.includes(String(check.assert.value).toLowerCase());
      } else if (check.assert.type === "textAbsent") {
        const body = (await page.locator("body").innerText({ timeout: 15000 })).toLowerCase();
        assertionPassed = !body.includes(String(check.assert.value).toLowerCase());
      }
      passed = check.expected === "pass" ? assertionPassed : !assertionPassed;
      detail = "assertion " + (assertionPassed ? "passed" : "failed") + " (expected " + check.expected + ") at " + page.url();
    } catch (error) {
      passed = check.expected === "fail";
      detail = "error: " + String(error && error.message ? error.message : error).split("\\n")[0];
    }
    results.push({
      id: entry.id,
      path: check.path,
      passed,
      pageErrors,
      consoleErrors,
      detail,
      durationMs: Date.now() - started,
    });
    await context.close();
  }
  await browser.close();
  process.stdout.write(JSON.stringify({ results }));
})().catch((error) => {
  process.stdout.write(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
  process.exit(1);
});
`;
}
