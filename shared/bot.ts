/**
 * Shared types + defaults for the CodeBot workspace configuration.
 * Persisted in `bot_settings` (workspace level). Keep in sync with the
 * zod schemas in shared/schema.ts and the runner that consumes them.
 */

export interface CommitReviewSettings {
  enabled: boolean;
  reviewDirect: boolean;
  scanDiffs: boolean;
  checkMessages: boolean;
  suggestFixes: boolean;
  autoApplySafeFixes: boolean;
  ignoreMergeCommits: boolean;
  ignoreReleaseCommits: boolean;
  maxCommitsPerRun: number;
}

export const COMMIT_REVIEW_DEFAULTS: CommitReviewSettings = {
  enabled: false,
  reviewDirect: false,
  scanDiffs: false,
  checkMessages: false,
  suggestFixes: false,
  autoApplySafeFixes: false,
  ignoreMergeCommits: false,
  ignoreReleaseCommits: false,
  maxCommitsPerRun: 50,
};

export interface PullRequestReviewSettings {
  autoReview: boolean;
  reviewDrafts: boolean;
  reReviewOnPush: boolean;
  inlineComments: boolean;
  summaryComment: boolean;
  requestChangesOnCritical: boolean;
  ignoreGenerated: boolean;
  skipBotsAndForks: boolean;
  commentLimit: number;
}

export const PULL_REQUEST_REVIEW_DEFAULTS: PullRequestReviewSettings = {
  autoReview: false,
  reviewDrafts: false,
  reReviewOnPush: true,
  inlineComments: true,
  summaryComment: true,
  requestChangesOnCritical: false,
  ignoreGenerated: true,
  skipBotsAndForks: true,
  commentLimit: 20,
};

export const BOT_AUTONOMY_LEVELS = ["manual", "assisted", "autonomous"] as const;
export type BotAutonomyLevel = (typeof BOT_AUTONOMY_LEVELS)[number];

export interface BotWorkspaceConfig {
  /** Freeform instructions injected into every review prompt. */
  instructions: string;
  /** How much the bot may change and re-review without being asked. */
  autonomy: BotAutonomyLevel;
  pullRequests: PullRequestReviewSettings;
}

export const BOT_WORKSPACE_DEFAULTS: BotWorkspaceConfig = {
  instructions: "",
  autonomy: "manual",
  pullRequests: { ...PULL_REQUEST_REVIEW_DEFAULTS },
};

export interface BotSettingsPayload {
  commitReviews: CommitReviewSettings;
  settings: BotWorkspaceConfig;
}

export const BOT_SETTINGS_DEFAULTS: BotSettingsPayload = {
  commitReviews: { ...COMMIT_REVIEW_DEFAULTS },
  settings: {
    instructions: BOT_WORKSPACE_DEFAULTS.instructions,
    autonomy: BOT_WORKSPACE_DEFAULTS.autonomy,
    pullRequests: { ...BOT_WORKSPACE_DEFAULTS.pullRequests },
  },
};

/** Merge a partial stored payload with defaults, ignoring unknown keys. */
export function normalizeBotSettings(raw: unknown): BotSettingsPayload {
  const source = (raw ?? {}) as {
    commitReviews?: Partial<CommitReviewSettings>;
    settings?: Partial<BotWorkspaceConfig> & { pullRequests?: Partial<PullRequestReviewSettings> };
  };
  const storedAutonomy = source.settings?.autonomy;
  return {
    commitReviews: { ...COMMIT_REVIEW_DEFAULTS, ...(source.commitReviews ?? {}) },
    settings: {
      instructions:
        typeof source.settings?.instructions === "string"
          ? source.settings.instructions
          : BOT_WORKSPACE_DEFAULTS.instructions,
      autonomy:
        typeof storedAutonomy === "string" &&
        (BOT_AUTONOMY_LEVELS as readonly string[]).includes(storedAutonomy)
          ? (storedAutonomy as BotAutonomyLevel)
          : BOT_WORKSPACE_DEFAULTS.autonomy,
      pullRequests: { ...PULL_REQUEST_REVIEW_DEFAULTS, ...(source.settings?.pullRequests ?? {}) },
    },
  };
}
