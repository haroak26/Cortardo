import { fixtureFiles } from "../../fixtures/prs";
import { ScenarioSandbox, type Scenario } from "./scenario";
import { CortadoEngine } from "../../src/engine";
import { silentLogger } from "../../src/util/logger";
import { SimulatedClock } from "../../src/util/clock";
import type { CortadoResult } from "../../src/types";

export interface ScenarioRun {
  result: CortadoResult;
  sandbox: ScenarioSandbox;
}

export async function runScenario(scenario: Scenario): Promise<ScenarioRun> {
  const clock = new SimulatedClock();
  const sandbox = new ScenarioSandbox(scenario, fixtureFiles(scenario.fixture), clock);
  const engine = new CortadoEngine({
    mode: "dry",
    sandbox,
    clock,
    logger: silentLogger,
    dryOptions: { repairBehavior: scenario.repair },
  });
  const result = await engine.run(scenario.fixture.pullRequest);
  return { result, sandbox };
}
