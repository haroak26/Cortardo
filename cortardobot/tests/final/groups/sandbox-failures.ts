import assert from "node:assert/strict";
import { CortadoEngine } from "../../../src/engine";
import { FIXTURES, fixtureFiles } from "../../../fixtures/prs";
import { ScenarioSandbox, type ProofBehavior } from "../../dry/scenario";
import { SimulatedClock } from "../../../src/util/clock";
import { silentLogger } from "../../../src/util/logger";
import { defineCases } from "../../exhaustive/types";
import type { ExecOptions, ExecResult, Sandbox } from "../../../src/sandbox";
import type { PatchApplyResult } from "../../../src/util/diff";
import type { RepairBehavior } from "../../../src/models/dry";
import type { CortadoResult } from "../../../src/types";

class FaultySandbox implements Sandbox {
  readonly id: string;
  readonly root: string;
  readonly dryRun = true;
  readonly faults: Set<string>;

  constructor(private readonly inner: ScenarioSandbox, faults: Set<string>) {
    this.id = `faulty-${inner.id}`;
    this.root = inner.root;
    this.faults = faults;
  }

  get toolCalls(): number {
    return this.inner.toolCalls;
  }

  private check(name: string): void {
    if (this.faults.has(name)) throw new Error(`injected fault: ${name}`);
  }

  async setup(): Promise<void> {
    this.check("setup");
    return this.inner.setup();
  }

  async warm(): Promise<void> {
    this.check("warm");
    return this.inner.warm();
  }

  async read(path: string): Promise<string> {
    this.check("read");
    return this.inner.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    this.check("write");
    return this.inner.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    this.check("exists");
    return this.inner.exists(path);
  }

  async list(dir?: string): Promise<string[]> {
    this.check("list");
    return this.inner.list(dir);
  }

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    this.check("exec");
    return this.inner.exec(command, options);
  }

  async applyPatch(patch: string): Promise<PatchApplyResult> {
    this.check("applyPatch");
    return this.inner.applyPatch(patch);
  }

  async snapshot(): Promise<Record<string, string>> {
    this.check("snapshot");
    return this.inner.snapshot();
  }

  async cleanup(): Promise<void> {
    this.check("cleanup");
    return this.inner.cleanup();
  }
}

interface FaultOptions {
  proof?: ProofBehavior;
  repair?: RepairBehavior;
  trivial?: boolean;
}

async function runFaulty(faults: string[], options: FaultOptions = {}) {
  const fixture = FIXTURES[0];
  const clock = new SimulatedClock();
  const scenario = {
    fixture,
    proof: options.proof ?? ("confirm" as ProofBehavior),
    repair: options.repair ?? ("fix" as RepairBehavior),
  };
  const inner = new ScenarioSandbox(scenario, fixtureFiles(fixture), clock);
  const sandbox = new FaultySandbox(inner, new Set(faults));
  const engine = new CortadoEngine({
    mode: "dry",
    sandbox,
    clock,
    logger: silentLogger,
    dryOptions: { repairBehavior: scenario.repair },
  });
  const result: CortadoResult = await engine.run(
    options.trivial ? { title: "trivial", files: [] } : fixture.pullRequest,
  );
  return { result, sandbox, inner };
}

function stageFailed(result: CortadoResult, stage: string): boolean {
  return result.events.some((event) => event.stage === stage && event.status === "failed");
}

export function buildSandboxFailureGroup() {
  const singleFaults: Array<{ fault: string; verify: (result: CortadoResult) => void }> = [
    {
      fault: "setup",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "sandbox_setup"));
        assert.equal(result.findings.length, 1);
      },
    },
    {
      fault: "warm",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "sandbox_setup"));
      },
    },
    {
      fault: "read",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.repairs.length, 1);
        assert.equal(result.repairs[0].exit, "UNRESOLVED");
      },
    },
    {
      fault: "write",
      verify: (result) => {
        assert.equal(result.status, "completed");
      },
    },
    {
      fault: "exists",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
      },
    },
    {
      fault: "list",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.findings.length, 1);
      },
    },
    {
      fault: "exec",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "proof"));
        assert.equal(result.proofs.length, 0);
        assert.equal(result.repairs.length, 0);
      },
    },
    {
      fault: "applyPatch",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "repair"));
        assert.equal(result.repairs.length, 0);
      },
    },
    {
      fault: "snapshot",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "repair"));
      },
    },
    {
      fault: "cleanup",
      verify: (result) => {
        assert.equal(result.status, "completed");
        assert.ok(stageFailed(result, "cleanup"));
      },
    },
  ];

  const cases: Array<{ name: string; run: () => Promise<void> }> = singleFaults.map((entry) => ({
    name: `sandbox fault "${entry.fault}" is contained`,
    run: async () => {
      const { result } = await runFaulty([entry.fault]);
      entry.verify(result);
    },
  }));

  const combinations: Array<{ faults: string[]; options?: FaultOptions; check: (result: CortadoResult) => void }> = [
    {
      faults: ["setup", "cleanup"],
      check: (result) => {
        assert.ok(stageFailed(result, "sandbox_setup"));
        assert.ok(stageFailed(result, "cleanup"));
      },
    },
    {
      faults: ["setup", "warm"],
      check: (result) => {
        assert.equal(result.status, "completed");
      },
    },
    {
      faults: ["read", "exists"],
      check: (result) => {
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
      },
    },
    {
      faults: ["read", "list"],
      check: (result) => {
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
      },
    },
    {
      faults: ["exec", "applyPatch"],
      check: (result) => {
        assert.ok(stageFailed(result, "proof"));
        assert.equal(result.repairs.length, 0);
      },
    },
    {
      faults: ["applyPatch", "snapshot"],
      check: (result) => {
        assert.ok(stageFailed(result, "repair"));
      },
    },
    {
      faults: ["setup", "exec"],
      check: (result) => {
        assert.ok(stageFailed(result, "sandbox_setup"));
        assert.ok(stageFailed(result, "proof"));
      },
    },
    {
      faults: ["setup", "read", "list", "exec", "applyPatch", "snapshot", "cleanup"],
      check: (result) => {
        assert.equal(result.status, "completed");
      },
    },
    {
      faults: [],
      options: { trivial: true },
      check: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.findings.length, 0);
      },
    },
    {
      faults: ["exec"],
      options: { trivial: true },
      check: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.findings.length, 0);
      },
    },
    {
      faults: ["snapshot"],
      options: { trivial: true },
      check: (result) => {
        assert.equal(result.status, "completed");
      },
    },
    {
      faults: ["cleanup"],
      options: { trivial: true },
      check: (result) => {
        assert.ok(stageFailed(result, "cleanup"));
      },
    },
    {
      faults: ["exec"],
      options: { proof: "no-repro" },
      check: (result) => {
        assert.equal(result.status, "completed");
        assert.equal(result.repairs.length, 0);
      },
    },
    {
      faults: ["read"],
      options: { repair: "always-fail" },
      check: (result) => {
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
      },
    },
    {
      faults: ["snapshot"],
      options: { repair: "unsafe" },
      check: (result) => {
        assert.equal(result.status, "completed");
      },
    },
  ];

  for (const combination of combinations) {
    cases.push({
      name: `sandbox fault combination [${combination.faults.join("+") || "none"}]`,
      run: async () => {
        const { result } = await runFaulty(combination.faults, combination.options);
        assert.equal(result.status, "completed");
        combination.check(result);
      },
    });
  }

  return defineCases("sandbox-failures", cases);
}
