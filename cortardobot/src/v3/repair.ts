import type { Candidate, ContextPack, PRContext, ProofResult, RepairAttempt, RepairCachePayload, RepairEdit, RepairExit, RepairResult } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { ModelRouter } from "./models";
import type { CacheStore } from "./cache/store";
import { cacheKey } from "./cache/keys";
import { hashContent } from "./util";
import { unifiedDiffFromEdits } from "./patch";
import { buildContextPack } from "./agent/context-pack";
import { createRepairRunMemory, runRepairAgent } from "./agent/loop";
import type { Logger } from "./util";

export interface RepairDeps {
  sandbox: Sandbox;
  models: ModelRouter;
  profile: RepoProfile;
  logger: Logger;
  maxAttempts: number;
  maxRepairs: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  proveCandidate: (candidate: Candidate) => Promise<ProofResult>;
  /** Engine-provided, cache-aware context pack builder. */
  contextPackFor?: (candidate: Candidate, proof: ProofResult) => Promise<ContextPack>;
  cache?: CacheStore;
  cacheTtlMs?: number;
  repo?: string;
  headSha?: string;
  modelId?: string;
  instructions?: string;
  costNow?: () => number;
  now?: () => number;
  /** Settings fingerprint (instructions/learnings) baked into cache keys (3.3). */
  settingsFingerprint?: string;
  /** Reasoning effort for the codegen role, baked into cache keys (3.3). */
  reasoning?: string;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

function repairCacheParts(deps: RepairDeps, candidate: Candidate, originalContent: string, packHash: string) {
  return {
    repo: deps.repo,
    headSha: deps.headSha,
    model: deps.modelId,
    fileHashes: candidate.file ? { [candidate.file]: hashContent(originalContent) } : {},
    payload: {
      candidateId: candidate.id,
      claim: candidate.claim,
      evidence: candidate.evidence,
      check: candidate.check ?? null,
      packHash,
      settings: deps.settingsFingerprint ?? "",
      reasoning: deps.reasoning ?? "",
    },
  };
}

export async function repairFindings(
  confirmed: ProofResult[],
  candidates: Candidate[],
  context: PRContext,
  deps: RepairDeps,
): Promise<RepairResult[]> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results: RepairResult[] = [];
  const runMemory = createRepairRunMemory();

  for (const proof of confirmed) {
    const candidate = byId.get(proof.candidateId);
    if (!candidate) continue;
    if (results.length >= deps.maxRepairs) break;
    if (!candidate.file) continue;
    const started = now();
    const costBefore = deps.costNow?.() ?? 0;

    let originalContent: string;
    try {
      originalContent = await deps.sandbox.read(candidate.file);
    } catch (error) {
      results.push({
        candidateId: candidate.id,
        severity: candidate.severity,
        exit: "UNRESOLVED",
        attempts: [],
        durationMs: now() - started,
        toolCalls: 0,
        reason: `could not read ${candidate.file}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    let pack: ContextPack;
    try {
      pack = deps.contextPackFor
        ? await deps.contextPackFor(candidate, proof)
        : await buildContextPack({ candidate, context, sandbox: deps.sandbox, profile: deps.profile, proof, instructions: deps.instructions });
    } catch (error) {
      deps.logger.warn(`context pack failed for ${candidate.id}`, { error: error instanceof Error ? error.message : String(error) });
      pack = {
        candidateId: candidate.id,
        files: [],
        imports: [],
        symbols: [],
        tests: [],
        routes: [],
        diff: "",
        reproduction: proof.reproduction,
        check: candidate.check,
        detectorEvidence: candidate.evidence,
        hash: hashContent(proof.reproduction),
      };
    }

    const parts = repairCacheParts(deps, candidate, originalContent, pack.hash);
    const key = cacheKey("repair", parts);

    if (deps.cache) {
      const hit = await deps.cache.get<RepairCachePayload>(key);
      if (hit && Array.isArray(hit.value.finalEdits) && hit.value.exit === "VERIFIED" && hit.value.finalEdits.length > 0) {
        // The cached edits must not leak into the fallback agent when the
        // re-check fails; snapshot and restore on every non-verified path.
        const cachedSnapshot = new Map<string, string>();
        for (const edit of hit.value.finalEdits) {
          if (cachedSnapshot.has(edit.path)) continue;
          const prior = await deps.sandbox.read(edit.path).catch(() => undefined);
          if (prior !== undefined) cachedSnapshot.set(edit.path, prior);
        }
        const apply = await deps.sandbox.applyEdits(hit.value.finalEdits);
        if (apply.ok) {
          const recheck = await deps.proveCandidate(candidate);
          if (recheck.status === "disproven") {
            const finalPatch = unifiedDiffFromEdits(candidate.file, originalContent, hit.value.finalEdits);
            if (finalPatch.includes("@@")) {
              const saved = typeof hit.meta?.costUsd === "number" ? hit.meta.costUsd : 0;
              if (saved > 0) deps.cache.recordSaved(saved);
              results.push({
                candidateId: candidate.id,
                severity: candidate.severity,
                exit: "VERIFIED",
                attempts: [
                  {
                    attempt: 1,
                    strategy: "cached verified fix re-applied and re-verified",
                    edits: hit.value.finalEdits,
                    applied: true,
                    testPassed: true,
                    testOutput: recheck.explanation,
                    exit: "VERIFIED",
                  },
                ],
                finalPatch,
                finalEdits: hit.value.finalEdits,
                probe: hit.value.probe,
                durationMs: now() - started,
                toolCalls: 0,
                reason: "cached fix re-verified against the current file content",
                servedFromCache: true,
              });
              continue;
            }
          }
        }
        for (const [path, content] of cachedSnapshot) await deps.sandbox.write(path, content).catch(() => undefined);
        if (!cachedSnapshot.has(candidate.file)) await deps.sandbox.write(candidate.file, originalContent).catch(() => undefined);
        await deps.cache.delete(key);
      } else {
        deps.cache.recordMiss("repair");
      }
    }

    let outcome;
    try {
      outcome = await runRepairAgent({
        sandbox: deps.sandbox,
        profile: deps.profile,
        models: deps.models,
        candidate,
        context,
        proof,
        contextPack: pack,
        originalContent,
        logger: deps.logger,
        maxAttempts: deps.maxAttempts,
        maxTurns: Math.max(1, deps.maxTurns),
        maxToolsPerTurn: Math.max(1, deps.maxToolsPerTurn),
        proveCandidate: () => deps.proveCandidate(candidate),
        memory: runMemory,
        now: deps.now,
        signal: deps.signal,
      });
    } catch (error) {
      await deps.sandbox.write(candidate.file, originalContent).catch(() => undefined);
      results.push({
        candidateId: candidate.id,
        severity: candidate.severity,
        exit: "UNRESOLVED",
        attempts: [],
        durationMs: now() - started,
        toolCalls: 0,
        reason: `repair agent crashed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const result: RepairResult = {
      candidateId: candidate.id,
      severity: candidate.severity,
      exit: outcome.exit,
      attempts: outcome.attempts,
      finalPatch: outcome.finalPatch,
      finalEdits: outcome.finalEdits,
      probe: outcome.probe,
      durationMs: now() - started,
      toolCalls: outcome.toolCalls,
      reason: outcome.reason,
      agentTurns: outcome.turns,
      transcript: outcome.transcript,
    };
    results.push(result);

    if (deps.cache) {
      if (outcome.exit === "VERIFIED" && outcome.finalEdits && outcome.finalPatch?.includes("@@")) {
        const cost = Math.max(0, (deps.costNow?.() ?? costBefore) - costBefore);
        const payload: RepairCachePayload = {
          candidateId: candidate.id,
          exit: "VERIFIED",
          finalEdits: outcome.finalEdits,
          finalPatch: outcome.finalPatch,
          reason: outcome.reason,
          attempts: outcome.attempts,
          probe: outcome.probe,
        };
        await deps.cache.set({
          key,
          kind: "repair",
          value: payload,
          ttlMs: deps.cacheTtlMs,
          meta: { costUsd: Number(cost.toFixed(6)) },
        });
      } else {
        await deps.cache.delete(key);
      }
    }
  }

  return results;
}
