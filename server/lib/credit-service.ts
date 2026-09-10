import { storage } from "../storage";
import { PLAN_LIMITS } from "@shared/schema";
import type { PlanTier } from "@shared/schema";

export interface CreditBalance {
  balance: number;
  dailyUsed: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
}

export interface AllowanceCheck {
  allowed: boolean;
  reason?: string;
  balance: CreditBalance;
  monthlyUsed: number;
  monthlyAllowance: number | "unlimited";
  dailyAllowance: number | "unlimited";
}

export async function ensureCredits(userId: string): Promise<void> {
  await storage.ensureCreditRecord(userId);
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  return storage.getCredits(userId);
}

export async function getMonthlyUsage(userId: string): Promise<number> {
  return storage.getMonthlyCreditUsage(userId);
}

export async function checkAllowance(
  userId: string,
  plan: PlanTier,
  estimatedCredits: number,
): Promise<AllowanceCheck> {
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const monthlyAllowance = limits.aiCredits.monthly;
  const dailyAllowance = limits.aiCredits.daily;
  const balance = await storage.getCredits(userId);
  const monthlyUsed = await storage.getMonthlyCreditUsage(userId);

  // Sum active holds so concurrent runs can't bypass the check
  const activeHolds = await storage.getActiveHolds(userId);
  const totalHeld = activeHolds.reduce((s, h) => s + h.amount, 0);
  const availableBalance = Math.max(0, balance.balance - totalHeld);

  const res: AllowanceCheck = {
    allowed: true,
    balance,
    monthlyUsed,
    monthlyAllowance,
    dailyAllowance,
  };

  if (monthlyAllowance === 0) {
    res.allowed = false;
    res.reason = "Your plan does not include AI agent credits. Upgrade to Hobby to use the AI agent.";
    return res;
  }

  // Unlimited plans (Professional / Enterprise): no monthly or daily caps.
  if (monthlyAllowance !== "unlimited") {
    const monthlyRemaining = monthlyAllowance - monthlyUsed;
    const effectiveCredits = Math.max(0, estimatedCredits - Math.max(0, monthlyRemaining));

    if (monthlyUsed >= monthlyAllowance && availableBalance < estimatedCredits) {
      res.allowed = false;
      res.reason = `Monthly credit allowance used (${monthlyUsed}/${monthlyAllowance}). Buy more credits or wait until next month.`;
      return res;
    }

    if (availableBalance < effectiveCredits) {
      const effectiveAvailable = availableBalance + Math.max(0, monthlyRemaining);
      res.allowed = false;
      res.reason = `You don't have enough credits. Need ${estimatedCredits} credits but only have ${effectiveAvailable.toFixed(1)} available${totalHeld > 0 ? ` (${totalHeld.toFixed(1)} held in active runs)` : ""}.`;
      return res;
    }
  }

  // Daily limit: check actual usage + held against allowance
  // Don't add estimatedCredits — the estimate is a worst-case, not actual spend.
  // Monthly/budget checks above already verify credit sufficiency.
  if (dailyAllowance !== "unlimited" && balance.dailyUsed >= dailyAllowance) {
    res.allowed = false;
    res.reason = `Daily credit limit reached (${balance.dailyUsed}/${dailyAllowance}). Try again tomorrow.`;
    return res;
  }

  return res;
}

export async function deductCredits(
  userId: string,
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  return storage.deductCredits(userId, amount, description, metadata ?? {});
}

export async function addCredits(
  userId: string,
  amount: number,
  description: string,
  metadata?: Record<string, unknown>,
): Promise<number> {
  return storage.addCredits(userId, amount, description, metadata ?? {});
}

export async function createHold(
  userId: string,
  amount: number,
  runId?: string,
): Promise<string> {
  return storage.createCreditHold(userId, amount, runId);
}

export async function releaseHold(
  holdId: string,
  actualCredits: number,
): Promise<void> {
  return storage.releaseCreditHold(holdId, actualCredits);
}

export async function getActiveHolds(userId: string): Promise<Array<{ id: string; amount: number; createdAt: Date }>> {
  return storage.getActiveHolds(userId);
}

export async function releaseStaleHolds(): Promise<number> {
  return storage.releaseStaleHolds();
}
