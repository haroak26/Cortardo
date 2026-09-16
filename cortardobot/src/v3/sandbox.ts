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
  /** Repo-wide test file index discovered during setup (3.4). */
  testFiles?: string[];
}

export interface Sandbox {
  readonly id: string;
  readonly root: string;
  prepare(options: { cloneUrl: string; token: string; ref: string; headBranch?: string }): Promise<void>;
  install(): Promise<void>;
  profile(): Promise<RepoProfile>;
  exec(command: string, options?: { cwd?: string; timeoutMs?: number; allowFailure?: boolean; signal?: AbortSignal }): Promise<ExecResult>;
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

/**
 * Playwright check script executed inside the sandbox.
 *
 * Reliability rules (3.1):
 * - never use fixed sleeps as the primary signal; poll with timeouts,
 * - harness failures are explicit (`harnessError`) and never count as a
 *   defect signal,
 * - a navigation is retried once before giving up.
 */
export function buildBrowserScript(): string {
  return `const fs = require("fs");
const { chromium } = require("playwright");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    let assertionPassed = false;
    let harnessError = false;
    let detail = "";
    let landedPath = "";
    const timeoutMs = typeof check.timeoutMs === "number" && check.timeoutMs > 0 ? check.timeoutMs : 20000;
    try {
      let loaded = false;
      let lastError = "";
      for (let attempt = 1; attempt <= 2 && !loaded; attempt++) {
        try {
          await page.goto(baseUrl + check.path, { waitUntil: "load", timeout: 45000 });
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
          await page
            .waitForFunction("document.body && document.body.innerText && document.body.innerText.trim().length > 0", null, { timeout: 20000 })
            .catch(() => {});
          loaded = true;
        } catch (error) {
          lastError = String(error && error.message ? error.message : error);
        }
      }
      if (!loaded) throw new Error("navigation failed: " + lastError);

      try {
        landedPath = new URL(page.url()).pathname;
      } catch (error) {
        landedPath = "";
      }
      const redirected = !check.clickText && check.assert.type !== "pathEquals" && landedPath !== check.path;
      if (redirected) {
        harnessError = true;
        passed = false;
        detail = "harness error: " + check.path + " redirected to " + (landedPath || page.url()) + "; the assertion never evaluated " + check.path;
      } else {
        if (check.clickText) {
          const locator = page.getByText(check.clickText, { exact: false }).first();
          await locator.waitFor({ state: "visible", timeout: timeoutMs });
          await locator.click({ timeout: timeoutMs });
          await sleep(350);
        }

        if (check.assert.type === "noPageError") {
          await sleep(1500);
          assertionPassed = pageErrors.length === 0;
        } else if (check.assert.type === "pathEquals") {
          const expected = String(check.assert.value);
          const deadline = Date.now() + timeoutMs;
          let current = new URL(page.url()).pathname;
          while (Date.now() < deadline && current !== expected) {
            await sleep(250);
            current = new URL(page.url()).pathname;
          }
          assertionPassed = current === expected;
        } else if (check.assert.type === "textContains") {
          const needle = String(check.assert.value).toLowerCase();
          const deadline = Date.now() + timeoutMs;
          let body = "";
          do {
            body = (await page.locator("body").innerText().catch(() => "")) || "";
            if (!body.toLowerCase().includes(needle)) await sleep(300);
          } while (Date.now() < deadline && !body.toLowerCase().includes(needle));
          assertionPassed = body.toLowerCase().includes(needle);
        } else if (check.assert.type === "textAbsent") {
          const needle = String(check.assert.value).toLowerCase();
          await sleep(1500);
          const body = (await page.locator("body").innerText().catch(() => "")) || "";
          assertionPassed = !body.toLowerCase().includes(needle);
        }

        passed = check.expected === "pass" ? assertionPassed : !assertionPassed;
        detail =
          "assertion " +
          (assertionPassed ? "passed" : "failed") +
          " (expected " +
          check.expected +
          ") at " +
          page.url();
      }
    } catch (error) {
      harnessError = true;
      passed = false;
      detail = "harness error: " + String(error && error.message ? error.message : error).split("\\n")[0];
    }
    results.push({
      id: entry.id,
      path: check.path,
      passed,
      pageErrors,
      consoleErrors,
      detail,
      durationMs: Date.now() - started,
      landedPath,
      harnessError,
    });
    await context.close().catch(() => {});
  }
  await browser.close();
  process.stdout.write(JSON.stringify({ results }));
})().catch((error) => {
  process.stdout.write(JSON.stringify({ error: String(error && error.message ? error.message : error) }));
  process.exit(1);
});
`;
}
