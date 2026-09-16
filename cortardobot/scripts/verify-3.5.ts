/**
 * CortardoBot 3.5 verification gate.
 *
 * Runs the deterministic checks that must pass before any deploy or live E2E:
 * strict typecheck plus the engine test suites (context graph, tool policies,
 * reproduce-or-drop, fix loop, clean replay, soft budgets, secret projection).
 * Makes no network calls and never touches E2B or the gateway.
 *
 *   npm run verify:3.5
 */
import { spawnSync } from "node:child_process";

interface Step {
  name: string;
  command: string;
  args: string[];
}

const steps: Step[] = [
  { name: "typecheck (cortardobot)", command: "npx", args: ["tsc", "--noEmit"] },
  { name: "3.5 engine tests", command: "node", args: ["--import", "tsx", "--test", "tests/engine/*.test.ts"] },
];

let failed = false;
for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) {
    console.error(`\n[verify:3.5] FAILED at: ${step.name}`);
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log("\n[verify:3.5] all 3.5 deterministic checks passed");
