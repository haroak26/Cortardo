import { buildHardeningGroup } from "./groups/fixes";
import { buildLiveHardeningGroup } from "./groups/live";
import type { ExhaustiveCase } from "../exhaustive/types";

export const HARDENING_TARGET = 48;

export function buildHardeningCases(): ExhaustiveCase[] {
  const cases = [...buildHardeningGroup(), ...buildLiveHardeningGroup()];
  if (cases.length !== HARDENING_TARGET) {
    throw new Error(`hardening suite expected ${HARDENING_TARGET} cases, found ${cases.length}`);
  }
  return cases;
}
