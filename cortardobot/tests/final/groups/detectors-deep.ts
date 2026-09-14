import assert from "node:assert/strict";
import {
  detectForFiles,
  detectorFix,
  detectorPresentInContent,
  type DetectorFinding,
} from "../../../src/agents/detectors";
import { DETECTOR_SAMPLES } from "../../exhaustive/groups/analysis";
import { defineCases } from "../../exhaustive/types";

const ALL_KINDS = [
  "bug",
  "auth",
  "security",
  "regression",
  "runtime",
  "performance",
  "database",
  "api",
  "ui",
  "config",
] as const;

function detectSample(sample: (typeof DETECTOR_SAMPLES)[number]) {
  const { file, content } = sample.positive();
  const finding = detectForFiles([file], [...ALL_KINDS], 50).find(
    (item) => item.ruleId === sample.id,
  ) as DetectorFinding;
  assert.ok(finding, `${sample.id} did not fire`);
  return { content, finding };
}

export function buildDetectorsDeepGroup() {
  const cases: Array<{ name: string; run: () => void }> = [];

  for (const sample of DETECTOR_SAMPLES) {
    cases.push({
      name: `${sample.id} fix is idempotent`,
      run: () => {
        const { content, finding } = detectSample(sample);
        const first = detectorFix(sample.id, content, finding);
        assert.ok(first);
        const second = detectorFix(sample.id, first.content, finding);
        assert.ok(second === null || second.content === first.content, `${sample.id} fix changed twice`);
        assert.equal(detectorPresentInContent(sample.id, first.content, finding), false);
      },
    });
    cases.push({
      name: `${sample.id} fix preserves unrelated content`,
      run: () => {
        const { content, finding } = detectSample(sample);
        const sentinel = "// unrelated sentinel line";
        const withSentinel = `${sentinel}\n${content}`;
        const fix = detectorFix(sample.id, withSentinel, finding);
        assert.ok(fix, `${sample.id} fix missing`);
        assert.ok(fix.content.includes(sentinel), `${sample.id} dropped unrelated content`);
      },
    });
  }

  for (const sample of DETECTOR_SAMPLES.slice(0, 8)) {
    cases.push({
      name: `${sample.id} detects behind added prefixes`,
      run: () => {
        const { content, finding } = detectSample(sample);
        const prefixed = `// leading comment\n\n${content}`;
        const refound = detectForFiles(
          [
            {
              path: finding.file,
              status: "modified",
              language: "TypeScript",
              additions: prefixed.split("\n").length,
              deletions: 0,
              addedLines: prefixed.split("\n").map((text, index) => ({ line: index + 1, text })),
              removedLines: [],
              content: prefixed,
            },
          ],
          [...ALL_KINDS],
          50,
        ).find((item) => item.ruleId === sample.id);
        assert.ok(refound, `${sample.id} missed after prefix`);
        const fix = detectorFix(sample.id, prefixed, refound);
        assert.ok(fix);
        assert.equal(detectorPresentInContent(sample.id, fix.content, refound), false);
      },
    });
  }

  assert.equal(cases.length, 30);
  return defineCases("detectors-deep", cases);
}
