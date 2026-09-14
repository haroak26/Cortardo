export interface ExhaustiveCase {
  id: string;
  group: string;
  name: string;
  run: () => void | Promise<void>;
}

export function defineCases(
  group: string,
  definitions: Array<{ name: string; run: () => void | Promise<void> }>,
): ExhaustiveCase[] {
  return definitions.map((definition, index) => ({
    id: `${group}-${String(index + 1).padStart(3, "0")}`,
    group,
    name: definition.name,
    run: definition.run,
  }));
}
