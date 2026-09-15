/**
 * CortardoBot 3.2 verification gate.
 *
 * Runs the deterministic 3.2 checks that must pass before any deploy or live
 * E2E: strict typecheck + the v3 test suites (agentic swarm, agent loop,
 * diagnosis, proof, batched verification, cache, publisher goldens, PR6
 * replay). Makes no network calls and never touches E2B or the gateway.
 *
 *   npm run verify:v3
 */
import { spawnSync } from "node:child_process";

interface Step {
  name: string;
  command: string;
  args: string[];
}

const steps: Step[] = [
  { name: "typecheck (cortardobot)", command: "npx", args: ["tsc", "--noEmit"] },
  { name: "3.2 test suites", command: "node", args: ["--import", "tsx", "--test", "tests/v3/*.test.ts"] },
];

let failed = false;
for (const step of steps) {
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(step.command, step.args, { stdio: "inherit", shell: true, env: process.env });
  if (result.status !== 0) {
    console.error(`\n[verify:v3] FAILED at: ${step.name}`);
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log("\n[verify:v3] all 3.2 deterministic checks passed");
