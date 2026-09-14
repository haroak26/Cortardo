import { FIXTURES, fixtureFiles } from "../fixtures/prs";
import { ScenarioSandbox } from "../tests/dry/scenario";
import { SimulatedClock } from "../src/util/clock";
import { CortadoEngine } from "../src/engine";
import { createLogger } from "../src/util/logger";
import { detectForFiles } from "../src/agents/detectors";
import { parseChangedFiles } from "../src/stages/change-intelligence";

const logger = createLogger({ level: "error" });

for (const fixture of FIXTURES) {
  const clock = new SimulatedClock();
  const sandbox = new ScenarioSandbox(
    { fixture, proof: "confirm", repair: "fix" },
    fixtureFiles(fixture),
    clock,
  );
  const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger });
  const result = await engine.run(fixture.pullRequest);

  const detected = detectForFiles(
    parseChangedFiles(fixture.pullRequest.files),
    ["bug", "auth", "security", "regression", "runtime", "performance", "database", "api", "ui", "config"],
    200,
  ).map((finding) => finding.ruleId);

  console.log(`\n=== ${fixture.id} [${result.status}] ===`);
  console.log(`classification: ${result.pr.classification.join(",")} (expected contains ${fixture.expected.classificationIncludes.join(",")})`);
  console.log(`size: ${result.pr.size} (expected ${fixture.expected.size})`);
  console.log(`detected rules: ${[...new Set(detected)].join(",")}`);
  console.log(`expected rules: ${fixture.expected.ruleIds.join(",")}`);
  console.log(`candidates: ${result.candidates.length} (min ${fixture.expected.minCandidates})`);
  for (const candidate of result.candidates) {
    const decision = result.decisions.find((item) => item.hypothesisId === candidate.id);
    const proof = result.proofs.find((item) => item.candidateId === candidate.id);
    const repair = result.repairs.find((item) => item.candidateId === candidate.id);
    console.log(
      `  - ${candidate.severity}/${candidate.agentKind} ${candidate.tags.filter((t) => t.startsWith("rule:")).join(",")} :: ${candidate.claim.slice(0, 70)} | ${decision?.verdict} | ${proof?.status ?? "-"} | ${repair?.exit ?? "-"}`,
    );
  }
  console.log(`summary: found=${result.summary.issuesFound} confirmed=${result.summary.issuesConfirmed} fixed=${result.summary.issuesFixed} verified=${result.summary.issuesVerified}`);
  console.log(`stages: ${Object.keys(result.timings).join(",")}`);
  if (result.status !== "completed") console.log(`ERROR: ${result.error}`);
}
