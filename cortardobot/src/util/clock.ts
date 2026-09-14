export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class SimulatedClock implements Clock {
  private current: number;
  private autoAdvanceMs: number;

  constructor(start = 1_700_000_000_000, autoAdvanceMs = 0) {
    this.current = start;
    this.autoAdvanceMs = autoAdvanceMs;
  }

  now(): number {
    const value = this.current;
    this.current += this.autoAdvanceMs;
    return value;
  }

  advance(ms: number): void {
    this.current += ms;
  }

  setAutoAdvance(ms: number): void {
    this.autoAdvanceMs = ms;
  }

  async sleep(ms: number): Promise<void> {
    this.current += ms;
  }
}

export interface Deadline {
  remainingMs(): number;
  expired(): boolean;
  readonly startedAt: number;
  readonly budgetMs: number;
}

export function createDeadline(budgetMs: number, clock: Clock = systemClock): Deadline {
  const startedAt = clock.now();
  return {
    startedAt,
    budgetMs,
    remainingMs: () => budgetMs - (clock.now() - startedAt),
    expired: () => clock.now() - startedAt >= budgetMs,
  };
}
