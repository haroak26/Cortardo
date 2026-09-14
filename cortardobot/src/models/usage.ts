import { creditsFromTokens, type ModelConfig } from "../config";
import { ModelCallLimitError, type UsageLike } from "./types";

export class UsageTracker {
  private calls = 0;
  private callsByRole: Record<string, number> = {};
  private tokensIn = 0;
  private tokensOut = 0;
  private credits = 0;
  private costUsd = 0;
  private modelMs = 0;
  private readonly models: ModelConfig;
  private readonly maxCalls?: number;

  constructor(options: { models: ModelConfig; maxCalls?: number }) {
    this.models = options.models;
    this.maxCalls = options.maxCalls;
  }

  ensureCapacity(): void {
    if (this.maxCalls !== undefined && this.calls >= this.maxCalls) {
      throw new ModelCallLimitError(this.maxCalls);
    }
  }

  begin(role: string): void {
    this.ensureCapacity();
    this.calls++;
    this.callsByRole[role] = (this.callsByRole[role] ?? 0) + 1;
  }

  recordTokens(tokensIn: number, tokensOut: number, durationMs: number, costUsd?: number): void {
    this.tokensIn += tokensIn;
    this.tokensOut += tokensOut;
    if (costUsd !== undefined && Number.isFinite(costUsd) && costUsd > 0) {
      this.costUsd += costUsd;
      this.credits += costUsd * 1000;
    } else {
      this.credits += creditsFromTokens(tokensIn, tokensOut, this.models);
    }
    this.modelMs += durationMs;
  }

  record(role: string, tokensIn: number, tokensOut: number, durationMs: number, costUsd?: number): void {
    this.begin(role);
    this.recordTokens(tokensIn, tokensOut, durationMs, costUsd);
  }

  snapshot(): UsageLike {
    return {
      calls: this.calls,
      callsByRole: { ...this.callsByRole },
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      credits: Math.round(this.credits * 1000) / 1000,
      costUsd: Math.round(this.costUsd * 1_000_000) / 1_000_000,
      modelMs: this.modelMs,
    };
  }
}
