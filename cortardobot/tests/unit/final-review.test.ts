import assert from "node:assert/strict";
import test from "node:test";
import { deterministicFinalReview, reviewFindings } from "../../src/stages/final-review";
import { ModelRouter } from "../../src/models/router";
import { resolveConfig } from "../../src/config";
import { silentLogger } from "../../src/util/logger";
import { makeContext, makeFinding, makeRepair, makeVerification } from "../helpers/factories";
import type { ModelClient, ModelResponse, ModelTask } from "../../src/models/types";

class StubModel implements ModelClient {
  readonly id = "stub";
  readonly dryRun = true;
  constructor(private readonly text: string) {}
  async complete(_task: ModelTask): Promise<ModelResponse> {
    return { text: this.text, model: this.id, tokensIn: 1, tokensOut: 1, durationMs: 1 };
  }
}

const config = resolveConfig({ mode: "dry" });

function routerWith(text: string): ModelRouter {
  const stub = new StubModel(text);
  return new ModelRouter({ config: config.models, mode: "dry", luna: stub, terra: stub, astra: stub });
}

test("deterministicFinalReview approves verified findings", () => {
  const review = deterministicFinalReview(
    makeFinding({ repair: makeRepair({ exit: "VERIFIED" }), verification: makeVerification({ passed: true }) }),
  );
  assert.equal(review.approval, "approve");
  assert.equal(review.fixCorrectness, "correct");
});

test("deterministicFinalReview requests changes for unresolved findings", () => {
  const review = deterministicFinalReview(
    makeFinding({ repair: makeRepair({ exit: "UNRESOLVED" }) }),
  );
  assert.equal(review.approval, "request_changes");
  assert.equal(review.fixCorrectness, "none");
  assert.match(review.summary, /could not be fixed/);
});

test("deterministicFinalReview marks unsafe repairs", () => {
  const review = deterministicFinalReview(makeFinding({ repair: makeRepair({ exit: "UNSAFE" }) }));
  assert.equal(review.risk, "high");
  assert.equal(review.fixCorrectness, "none");
  assert.match(review.summary, /unsafe/);
});

test("reviewFindings parses Astra output and fills missing candidates", async () => {
  const findings = [
    makeFinding({ candidateId: "c1" }),
    makeFinding({ candidateId: "c2", title: "Second finding" }),
  ];
  const router = routerWith(
    JSON.stringify({
      reviews: [
        {
          candidateId: "c1",
          validity: "valid",
          fixCorrectness: "correct",
          risk: "medium",
          approval: "approve",
          confidence: 0.9,
          summary: "Look good",
        },
        {
          candidateId: "unknown",
          validity: "valid",
          fixCorrectness: "correct",
          risk: "low",
          approval: "approve",
          confidence: 0.5,
          summary: "Unknown",
        },
      ],
    }),
  );
  const reviews = await reviewFindings(findings, makeContext(), {
    models: router,
    config,
    logger: silentLogger,
  });
  assert.equal(reviews.length, 2);
  assert.equal(reviews.find((review) => review.candidateId === "c1")?.summary, "Look good");
  assert.ok(reviews.find((review) => review.candidateId === "c2"));
  assert.ok(!reviews.some((review) => review.candidateId === "unknown"));
});

test("reviewFindings falls back when Astra returns invalid JSON", async () => {
  const findings = [makeFinding({ candidateId: "c1", repair: makeRepair({ exit: "VERIFIED" }), verification: makeVerification({ passed: true }) })];
  const reviews = await reviewFindings(findings, makeContext(), {
    models: routerWith("not json"),
    config,
    logger: silentLogger,
  });
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].approval, "approve");
});

test("reviewFindings returns nothing for an empty finding list", async () => {
  const reviews = await reviewFindings([], makeContext(), {
    models: routerWith("{}"),
    config,
    logger: silentLogger,
  });
  assert.deepEqual(reviews, []);
});
