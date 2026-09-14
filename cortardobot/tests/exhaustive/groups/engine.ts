import assert from "node:assert/strict";
import { CortadoEngine } from "../../../src/engine";
import { FIXTURES, fixtureFiles } from "../../../fixtures/prs";
import { ScenarioSandbox } from "../../dry/scenario";
import { MemorySandbox } from "../../../src/sandbox";
import { assessCommand } from "../../../src/sandbox/safety";
import { SimulatedClock } from "../../../src/util/clock";
import { silentLogger } from "../../../src/util/logger";
import { extractJson } from "../../../src/util/json";
import { applyUnifiedDiff, makeUnifiedDiff } from "../../../src/util/diff";
import { mergeEvidence } from "../../../src/stages/evidence-merge";
import { DEFAULT_CONFIG, resolveConfig } from "../../../src/config";
import { assembleResult } from "../../../src/result";
import { claimKey, normalizePath, relativePath, truncate, truncateMiddle } from "../../../src/util/text";
import { stableId, shortHash } from "../../../src/util/hash";
import { createDeadline, SimulatedClock as Clock } from "../../../src/util/clock";
import { mapLimit, retry, withTimeout, TimeoutError } from "../../../src/util/async";
import {
  makeCandidate,
  makeContext,
  makeFinding,
  makeHypothesis,
  makeProof,
  makeRepair,
  makeVerification,
} from "../../helpers/factories";
import { mulberry32, pick, randomInt, randomString } from "../prng";
import { defineCases } from "../types";
import type { ModelClient, ModelResponse, ModelTask } from "../../../src/models/types";
import type { FinalReview, PullRequestInput } from "../../../src/types";

const config = resolveConfig({ mode: "dry" });

class TrackingSandbox extends MemorySandbox {
  cleanupCalls = 0;
  override async cleanup(): Promise<void> {
    this.cleanupCalls++;
  }
}

const slowModel: ModelClient = {
  id: "slow",
  dryRun: true,
  complete: async (_task: ModelTask): Promise<ModelResponse> => {
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { text: "{}", model: "slow", tokensIn: 1, tokensOut: 1, durationMs: 60 };
  },
};

const garbageModel: ModelClient = {
  id: "garbage",
  dryRun: true,
  complete: async (): Promise<ModelResponse> => ({
    text: randomString(mulberry32(99), 120, "!@#$%^&*()_+{}[]|;:,.<>?/\\"),
    model: "garbage",
    tokensIn: 3,
    tokensOut: 3,
    durationMs: 1,
  }),
};

function authInput(): PullRequestInput {
  return FIXTURES[0].pullRequest;
}

function engineCases() {
  return [
    {
      name: "engine defaults to dry mode",
      run: () => {
        assert.equal(new CortadoEngine({}).config.mode, "dry");
      },
    },
    {
      name: "engine refuses live mode without a key",
      run: () => {
        assert.throws(() => new CortadoEngine({ mode: "live" }), /CORTADO_AI_API_KEY/);
      },
    },
    {
      name: "engine completes a trivial run",
      run: async () => {
        const result = await new CortadoEngine({ logger: silentLogger }).run({ title: "trivial", files: [] });
        assert.equal(result.status, "completed");
        assert.equal(result.dryRun, true);
      },
    },
    {
      name: "engine finds and fixes a planted auth bug in dry mode",
      run: async () => {
        const sessionBefore = 'export function authorize(userId: string, sessionUserId: string): boolean {\n  if (sessionUserId !== userId) {\n    return false;\n  }\n  return true;\n}\n';
        const sessionAfter = sessionBefore.replace("!==", "==");
        const result = await new CortadoEngine({ logger: silentLogger }).run({
          id: "auth",
          title: "auth",
          files: [
            {
              path: "server/auth/session.ts",
              content: sessionAfter,
              patch: makeUnifiedDiff("server/auth/session.ts", sessionBefore, sessionAfter),
            },
            { path: "server/auth/session.test.ts", content: "test('a', () => {});\n" },
          ],
        });
        assert.equal(result.summary.issuesVerified, 1);
        assert.match(result.markdown, /\[FIXED\]/);
      },
    },
    {
      name: "engine reports malformed input as failed",
      run: async () => {
        const result = await new CortadoEngine({ logger: silentLogger }).run({
          title: "broken",
          files: undefined as never,
        });
        assert.equal(result.status, "failed");
        assert.ok(result.error);
      },
    },
    {
      name: "engine enforces the global timeout",
      run: async () => {
        const engine = new CortadoEngine({
          models: { luna: slowModel, terra: slowModel, astra: slowModel },
          globalTimeoutMs: 5,
          logger: silentLogger,
        });
        const result = await engine.run({ title: "timeout", files: [] });
        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", /timed out/);
      },
    },
    {
      name: "engine survives garbage model output",
      run: async () => {
        const engine = new CortadoEngine({
          models: { luna: garbageModel, terra: garbageModel, astra: garbageModel },
          logger: silentLogger,
        });
        const result = await engine.run(authInput());
        assert.equal(result.status, "completed");
        assert.equal(result.findings.length, 0);
      },
    },
    {
      name: "engine results are deterministic across runs",
      run: async () => {
        const runOnce = async () => {
          const clock = new SimulatedClock();
          const fixture = FIXTURES[0];
          const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair: "fix" }, fixtureFiles(fixture), clock);
          const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger: silentLogger });
          return engine.run(fixture.pullRequest);
        };
        const first = await runOnce();
        const second = await runOnce();
        assert.equal(first.markdown, second.markdown);
        assert.deepEqual(first.summary, second.summary);
      },
    },
    {
      name: "engine cleans up the sandbox after a run",
      run: async () => {
        const sandbox = new TrackingSandbox({ files: {} });
        const engine = new CortadoEngine({ mode: "dry", sandbox, logger: silentLogger });
        await engine.run({ title: "cleanup", files: [] });
        assert.equal(sandbox.cleanupCalls, 1);
      },
    },
    {
      name: "engine uses host supplied test commands",
      run: async () => {
        const clock = new SimulatedClock();
        const fixture = FIXTURES[0];
        const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair: "fix" }, fixtureFiles(fixture), clock);
        const engine = new CortadoEngine({
          mode: "dry",
          sandbox,
          clock,
          logger: silentLogger,
          commands: { test: "echo full", testSingle: (file) => `echo single ${file}` },
        });
        await engine.run(fixture.pullRequest);
        assert.ok(sandbox.commands.some((command) => command.startsWith("echo single")));
      },
    },
    {
      name: "engine honours dry repair behavior overrides",
      run: async () => {
        const clock = new SimulatedClock();
        const fixture = FIXTURES[0];
        const sandbox = new ScenarioSandbox(
          { fixture, proof: "confirm", repair: "always-fail" },
          fixtureFiles(fixture),
          clock,
        );
        const engine = new CortadoEngine({
          mode: "dry",
          sandbox,
          clock,
          logger: silentLogger,
          dryOptions: { repairBehavior: "always-fail" },
        });
        const result = await engine.run(fixture.pullRequest);
        assert.equal(result.repairs[0].exit, "UNRESOLVED");
      },
    },
    {
      name: "engine records usage and credits",
      run: async () => {
        const clock = new SimulatedClock();
        const fixture = FIXTURES[0];
        const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair: "fix" }, fixtureFiles(fixture), clock);
        const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger: silentLogger });
        const result = await engine.run(fixture.pullRequest);
        assert.ok(result.usage.calls > 0);
        assert.ok(result.usage.credits > 0);
      },
    },
    {
      name: "engine events follow pipeline order",
      run: async () => {
        const clock = new SimulatedClock();
        const fixture = FIXTURES[0];
        const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair: "fix" }, fixtureFiles(fixture), clock);
        const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger: silentLogger });
        const result = await engine.run(fixture.pullRequest);
        const order = result.events.map((event) => event.stage);
        const index = (stage: string) => order.indexOf(stage as never);
        assert.ok(index("change_intelligence") < index("swarm"));
        assert.ok(index("swarm") < index("judge"));
        assert.ok(index("judge") < index("repair"));
        assert.ok(index("repair") < index("verify"));
        assert.ok(index("verify") < index("assemble"));
        assert.ok(index("assemble") < index("cleanup"));
      },
    },
    {
      name: "engine markdown reports fixed findings",
      run: async () => {
        const clock = new SimulatedClock();
        const fixture = FIXTURES[0];
        const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair: "fix" }, fixtureFiles(fixture), clock);
        const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger: silentLogger });
        const result = await engine.run(fixture.pullRequest);
        assert.match(result.markdown, /\[FIXED\] HIGH/);
        assert.match(result.markdown, /Astra:/);
      },
    },
  ];
}

function resultCases() {
  const review: FinalReview = {
    candidateId: "c1",
    validity: "valid",
    fixCorrectness: "correct",
    risk: "medium",
    approval: "approve",
    confidence: 0.9,
    summary: "ok",
  };
  const base = {
    runId: "run_x",
    input: { id: "pr", title: "t" },
    context: makeContext(),
    candidates: [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2", claim: "Second defect here", file: "src/b.ts", evidence: ["src/b.ts:2"] })],
    decisions: [
      { hypothesisId: "c1", verdict: "PROVE" as const, reason: "", priority: 1 },
      { hypothesisId: "c2", verdict: "STATIC_ONLY" as const, reason: "", priority: 2 },
    ],
    proofs: [makeProof({ candidateId: "c1" })],
    repairs: [makeRepair({ candidateId: "c1" })],
    verifications: { c1: makeVerification({ passed: true }) },
    reviews: [review],
    events: [],
    timings: {},
    usage: { calls: 3, callsByRole: {}, tokensIn: 1, tokensOut: 1, credits: 0.1, modelMs: 1 },
    dryRun: true,
    startedAt: 0,
    endedAt: 1000,
    status: "completed" as const,
  };
  return [
    {
      name: "result summary counts findings and exits",
      run: () => {
        const result = assembleResult(base);
        assert.equal(result.summary.issuesFound, 2);
        assert.equal(result.summary.issuesConfirmed, 1);
        assert.equal(result.summary.issuesFixed, 1);
        assert.equal(result.summary.issuesStaticOnly, 1);
        assert.equal(result.summary.exitStates.VERIFIED, 1);
      },
    },
    {
      name: "result findings exclude disproven proofs",
      run: () => {
        const result = assembleResult({
          ...base,
          proofs: [makeProof({ candidateId: "c1", status: "disproven" })],
          repairs: [],
          verifications: {},
          reviews: [],
        });
        assert.equal(result.findings.length, 0);
      },
    },
    {
      name: "result attaches repair and verification",
      run: () => {
        const finding = assembleResult(base).findings[0];
        assert.equal(finding.repair?.exit, "VERIFIED");
        assert.equal(finding.verification?.passed, true);
      },
    },
    {
      name: "result attaches the Astra review",
      run: () => {
        const finding = assembleResult(base).findings[0];
        assert.equal(finding.review?.approval, "approve");
      },
    },
    {
      name: "markdown marks fixed findings",
      run: () => {
        assert.match(assembleResult(base).markdown, /\[FIXED\]/);
      },
    },
    {
      name: "markdown marks unsafe repairs",
      run: () => {
        const result = assembleResult({
          ...base,
          repairs: [makeRepair({ candidateId: "c1", exit: "UNSAFE" })],
          verifications: {},
        });
        assert.match(result.markdown, /\[UNSAFE\]/);
      },
    },
    {
      name: "markdown lists static-only candidates",
      run: () => {
        assert.match(assembleResult(base).markdown, /Static only \(1\)/);
      },
    },
    {
      name: "markdown reports failures",
      run: () => {
        const result = assembleResult({ ...base, status: "failed", error: "boom" });
        assert.match(result.markdown, /Run failed: boom/);
      },
    },
    {
      name: "markdown handles empty runs",
      run: () => {
        const result = assembleResult({
          ...base,
          candidates: [],
          decisions: [],
          proofs: [],
          repairs: [],
          verifications: {},
          reviews: [],
        });
        assert.match(result.markdown, /No confirmed issues/);
      },
    },
    {
      name: "markdown is deterministic",
      run: () => {
        assert.equal(assembleResult(base).markdown, assembleResult(base).markdown);
      },
    },
  ];
}

function utilCases() {
  return [
    {
      name: "hashes are stable and short",
      run: () => {
        assert.equal(shortHash("value", 8), shortHash("value", 8));
        assert.equal(shortHash("value", 16).length, 16);
        assert.equal(shortHash("value", 4).length, 4);
      },
    },
    {
      name: "stable ids ignore undefined parts",
      run: () => {
        assert.equal(stableId("h", "a", undefined, "b"), stableId("h", "a", "b"));
      },
    },
    {
      name: "claim keys collapse punctuation and stopwords",
      run: () => {
        assert.equal(claimKey("The SQL statement is assembled"), claimKey("sql statement assembled"));
      },
    },
    {
      name: "claim keys separate distinct claims",
      run: () => {
        assert.notEqual(claimKey("SQL injection risk"), claimKey("XSS injection risk"));
      },
    },
    {
      name: "truncate keeps short strings and shortens long ones",
      run: () => {
        assert.equal(truncate("short", 10), "short");
        assert.equal(truncate("abcdefgh", 4).length, 4);
      },
    },
    {
      name: "truncateMiddle preserves both ends",
      run: () => {
        const result = truncateMiddle("abcdefghijklmno", 9);
        assert.ok(result.startsWith("abcd"));
        assert.ok(result.endsWith("lmno"));
        assert.equal(result.length, 9);
      },
    },
    {
      name: "path helpers normalize and compute relatives",
      run: () => {
        assert.equal(normalizePath("./src\\app.ts"), "src/app.ts");
        assert.equal(relativePath("src/lib/a.ts", "src/lib/b.ts"), "./b.ts");
        assert.equal(relativePath("src/lib/a.ts", "src/other/b.ts"), "../other/b.ts");
      },
    },
    {
      name: "extractJson parses plain objects",
      run: () => {
        assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
      },
    },
    {
      name: "extractJson parses fenced blocks",
      run: () => {
        assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
      },
    },
    {
      name: "extractJson respects strings with braces",
      run: () => {
        assert.deepEqual(extractJson('{"text":"{ } } {","n":1}'), { text: "{ } } {", n: 1 });
      },
    },
    {
      name: "extractJson rejects garbage",
      run: () => {
        assert.throws(() => extractJson("no json"), /could not parse JSON/);
        assert.throws(() => extractJson(""), /empty model response/);
      },
    },
    {
      name: "mapLimit preserves order within the limit",
      run: async () => {
        const results = await mapLimit([5, 4, 3, 2, 1], 2, async (value) => value * 2);
        assert.deepEqual(results, [10, 8, 6, 4, 2]);
      },
    },
    {
      name: "withTimeout resolves, rejects and falls back",
      run: async () => {
        assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
        assert.equal(await withTimeout(new Promise((resolve) => setTimeout(resolve, 30)), 5, () => 42), 42);
        await assert.rejects(
          () => withTimeout(new Promise((resolve) => setTimeout(resolve, 30)), 5),
          TimeoutError,
        );
      },
    },
    {
      name: "clock and deadline behave deterministically",
      run: async () => {
        const clock = new Clock(100, 0);
        const deadline = createDeadline(50, clock);
        assert.equal(deadline.expired(), false);
        clock.advance(50);
        assert.equal(deadline.expired(), true);
        let attempts = 0;
        await retry(
          async () => {
            attempts++;
            if (attempts < 2) throw new Error("transient");
            return "ok";
          },
          { retries: 2, delayMs: 1 },
        );
        assert.equal(attempts, 2);
      },
    },
  ];
}

function robustnessCases() {
  const randomPr = (seed: number): PullRequestInput => {
    const rand = mulberry32(seed * 104729 + 3);
    const fileCount = randomInt(rand, 0, 8);
    const files = Array.from({ length: fileCount }, (_, index) => {
      const directory = pick(rand, ["src", "server", "client", "tests", "config"]);
      const name = `${randomString(rand, randomInt(rand, 3, 10)).trim() || "file"}-${index}`;
      const extension = pick(rand, [".ts", ".tsx", ".py", ".json", ".yaml"]);
      const path = `${directory}/${name}${extension}`;
      const before = `${randomString(rand, 40)}`;
      const after = `${randomString(rand, 40)}`;
      const includePatch = rand() > 0.5;
      return {
        path,
        content: after,
        ...(includePatch ? { patch: makeUnifiedDiff(path, before, after) } : {}),
      };
    });
    return { id: `random-${seed}`, title: `Random PR ${seed}`, files };
  };

  return [
    ...Array.from({ length: 4 }, (_, index) => ({
      name: `engine survives random PR ${index + 1}`,
      run: async () => {
        const result = await new CortadoEngine({ logger: silentLogger }).run(randomPr(index + 1));
        assert.ok(["completed", "failed"].includes(result.status));
        assert.ok(result.markdown.length > 0);
      },
    })),
    {
      name: "random valid patches round trip",
      run: () => {
        const rand = mulberry32(4242);
        for (let index = 0; index < 10; index++) {
          const before = Array.from({ length: randomInt(rand, 1, 30) }, () => randomString(rand, 10)).join("\n") + "\n";
          const after = before + `extra-${index}\n`;
          const path = `fuzz/mutated-${index}.ts`;
          const files: Record<string, string> = { [path]: before };
          const applied = applyUnifiedDiff(makeUnifiedDiff(path, before, after), files);
          assert.equal(applied.ok, true, `patch ${index} failed`);
          assert.equal(files[path], after);
        }
      },
    },
    {
      name: "garbage patch strings never throw",
      run: () => {
        const rand = mulberry32(777);
        for (let index = 0; index < 25; index++) {
          const garbage = randomString(rand, randomInt(rand, 0, 300), "abc+-@ \n\\/");
          assert.doesNotThrow(() => applyUnifiedDiff(garbage, { "a.ts": "a\n" }));
        }
      },
    },
    {
      name: "random hypothesis sets always merge safely",
      run: () => {
        const rand = mulberry32(31337);
        for (let index = 0; index < 10; index++) {
          const hypotheses = Array.from({ length: randomInt(rand, 0, 20) }, (_, position) =>
            makeHypothesis({
              id: `h${index}-${position}`,
              claim: randomString(rand, randomInt(rand, 3, 60)),
              severity: pick(rand, ["info", "low", "medium", "high", "critical"] as const),
              confidence: rand(),
              evidence: rand() > 0.2 ? [`src/a.ts:${randomInt(rand, 1, 50)}`] : [],
              file: pick(rand, ["src/a.ts", "src/b.ts"]),
            }),
          );
          const { candidates } = mergeEvidence(hypotheses, makeContext(), DEFAULT_CONFIG);
          assert.ok(candidates.length <= DEFAULT_CONFIG.judge.maxCandidates);
          assert.ok(candidates.every((candidate) => candidate.evidence.length > 0));
        }
      },
    },
    {
      name: "random commands never crash the safety policy",
      run: () => {
        const rand = mulberry32(2024);
        for (let index = 0; index < 50; index++) {
          const command = randomString(rand, randomInt(rand, 0, 40), "abc -_/\\|;&$`'\"\n\t");
          const assessment = assessCommand(command);
          assert.equal(typeof assessment.allowed, "boolean");
        }
      },
    },
    {
      name: "random non-json output is rejected coherently",
      run: () => {
        const rand = mulberry32(8080);
        for (let index = 0; index < 25; index++) {
          const text = randomString(rand, randomInt(rand, 1, 80), "{}[]:,abc \n");
          try {
            extractJson(text);
          } catch (error) {
            assert.ok(error instanceof Error);
          }
        }
      },
    },
    {
      name: "engine tolerates duplicate file paths",
      run: async () => {
        const content = "export const value = 1;\n";
        const result = await new CortadoEngine({ logger: silentLogger }).run({
          title: "dupes",
          files: [
            { path: "src/a.ts", content },
            { path: "src/a.ts", content },
          ],
        });
        assert.equal(result.status, "completed");
      },
    },
    {
      name: "engine handles large patches without stalling",
      run: async () => {
        const before = Array.from({ length: 3000 }, (_, index) => `line ${index}`).join("\n") + "\n";
        const after = before.replace("line 1500", "line 1500 changed");
        const result = await new CortadoEngine({ logger: silentLogger }).run({
          title: "large",
          files: [
            {
              path: "src/large.ts",
              content: after,
              patch: makeUnifiedDiff("src/large.ts", before, after),
            },
          ],
        });
        assert.equal(result.status, "completed");
      },
    },
    {
      name: "engine handles patch-only entries without content",
      run: async () => {
        const result = await new CortadoEngine({ logger: silentLogger }).run({
          title: "patch only",
          files: [
            {
              path: "src/ghost.ts",
              patch: makeUnifiedDiff("src/ghost.ts", "old\n", "new\n"),
            },
          ],
        });
        assert.equal(result.status, "completed");
      },
    },
  ];
}

export function buildEngineGroup() {
  return defineCases("engine", [...engineCases(), ...resultCases(), ...utilCases(), ...robustnessCases()]);
}
