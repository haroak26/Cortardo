import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  real,
  json,
  jsonb,
  boolean,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { CodeGraphConnection, CodeGraphFile, CodeGraphSymbol, CodeGraphSymbolEdge } from "./codegraph";
import {
  BOT_WORKSPACE_DEFAULTS,
  COMMIT_REVIEW_DEFAULTS,
  type BotWorkspaceConfig,
  type CommitReviewSettings,
} from "./bot";

// ── Users ──────────────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  googleId: text("google_id").unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // Email verification
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpiry: timestamp("email_verification_expiry"),
  pendingEmail: text("pending_email"),
  pendingEmailToken: text("pending_email_token"),
  pendingEmailExpiry: timestamp("pending_email_expiry"),
  passwordResetToken: text("password_reset_token"),
  passwordResetExpiry: timestamp("password_reset_expiry"),
  // Email preferences
  newsletterSubscribed: boolean("newsletter_subscribed").notNull().default(true),
  productUpdates: boolean("product_updates").notNull().default(true),
  securityAlerts: boolean("security_alerts").notNull().default(true),
  billingUpdates: boolean("billing_updates").notNull().default(true),
  emailChangeCount: integer("email_change_count").notNull().default(0),
  theme: text("theme").notNull().default("system"),
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  onboardingStep: integer("onboarding_step").notNull().default(0),
  lastWorkspaceId: text("last_workspace_id"),
});

export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "password" | "emailVerificationToken" | "emailVerificationExpiry" | "pendingEmailToken" | "pendingEmailExpiry" | "passwordResetToken" | "passwordResetExpiry">;

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });

export const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const verifyEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Verification code must be 6 digits"),
});

export const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const updateProfileSchema = z.object({
  displayName: z.string().max(64, "Display name too long").optional(),
  email: z.string().email("Invalid email address").optional(),
  avatarUrl: z.string().max(500, "Avatar URL too long").nullable().optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Password is required to confirm deletion"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const onboardingStepSchema = z.object({
  step: z.number().int().min(0),
});

// ── Workspaces ─────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  supportCode: text("support_code").unique(),
  logoUrl: text("logo_url"),
  creditBudget: integer("credit_budget"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Workspace = typeof workspaces.$inferSelect;

export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id"),
  email: text("email").notNull(),
  role: text("role").notNull().default("editor"),
  inviteToken: text("invite_token"),
  inviteExpiry: timestamp("invite_expiry"),
  status: text("status").notNull().default("pending"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("workspace_member_email_idx").on(t.workspaceId, t.email),
]);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;

export const createWorkspaceSchema = z.object({
  name: z.string().min(2, "Workspace name is required").max(80),
  logoUrl: z.string().url("Logo must be a valid URL").max(1000).optional(),
  creditBudget: z.number().int().positive("Credit budget must be a positive number").optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  logoUrl: z.string().url().max(1000).optional(),
  creditBudget: z.number().int().positive("Credit budget must be a positive number").nullable().optional(),
});

export const inviteWorkspaceMemberSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  role: z.enum(["admin", "editor", "viewer"]).default("editor"),
});

export const updateWorkspaceMemberSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  displayName: z.string().min(1).max(200).optional(),
});

export const bulkInviteMemberSchema = z.object({
  emails: z.array(z.string().email()).min(1).max(50),
  role: z.enum(["admin", "editor", "viewer"]).default("editor"),
});

// ── Subscriptions & Plans ─────────────────────────────────────────────────

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  subscriptionStatus: text("subscription_status"),
  planRenewsAt: timestamp("plan_renews_at"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  billingPeriod: text("billing_period").notNull().default("monthly"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;

export const PLAN_TIERS = ["free", "pro", "team", "enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];
export type BillingPeriod = "monthly" | "annual";

export type PlanLimits = {
  label: string;
  prices: { monthly: number; annual: number };
  projects: number | "unlimited";
  designFiles: number | "unlimited";
  editors: number | "unlimited";
  viewers: number | "unlimited";
  storage: number;
  versionHistory: number;
  components: number;
  customFonts: boolean;
  exportPresets: boolean;
  advancedPrototyping: boolean;
  apiAccess: boolean;
  ssO: boolean;
  prioritySupport: boolean;
  aiCredits: { monthly: number | "unlimited"; daily: number | "unlimited" };
};

// Tier keys map to the plan lineup:
//   free → Free, pro → Hobby, team → Professional, enterprise → Enterprise
// 1 credit = $0.001 of AI API usage.
// Monthly credit allowance: Free 1500, Hobby 5000, Professional 20000, Enterprise unlimited.
// Pricing: $5/$20/$80 monthly, 20% off annually.
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    label: "Free", prices: { monthly: 0, annual: 0 },
    projects: 10, designFiles: 10, editors: 1, viewers: 1, storage: 100,
    versionHistory: 7, components: 10, customFonts: false,
    exportPresets: false, advancedPrototyping: false, apiAccess: false, ssO: false,
    prioritySupport: false, aiCredits: { monthly: 1500, daily: 500 },
  },
  pro: {
    label: "Hobby", prices: { monthly: 5, annual: 48 },
    projects: "unlimited", designFiles: 100, editors: 1, viewers: 10, storage: 2048,
    versionHistory: 30, components: 300, customFonts: true,
    exportPresets: true, advancedPrototyping: true, apiAccess: true, ssO: false,
    prioritySupport: false, aiCredits: { monthly: 5000, daily: "unlimited" },
  },
  team: {
    label: "Professional", prices: { monthly: 20, annual: 192 },
    projects: "unlimited", designFiles: 500, editors: 5, viewers: 50, storage: 10240,
    versionHistory: 90, components: 1000, customFonts: true,
    exportPresets: true, advancedPrototyping: true, apiAccess: true, ssO: false,
    prioritySupport: true, aiCredits: { monthly: 20000, daily: "unlimited" },
  },
  enterprise: {
    label: "Enterprise", prices: { monthly: 80, annual: 768 },
    projects: "unlimited", designFiles: "unlimited", editors: "unlimited", viewers: "unlimited", storage: 51200,
    versionHistory: 365, components: 10000, customFonts: true,
    exportPresets: true, advancedPrototyping: true, apiAccess: true, ssO: true,
    prioritySupport: true, aiCredits: { monthly: "unlimited", daily: "unlimited" },
  },
};

// ── Usage Tracking ────────────────────────────────────────────────────────

export const usage = pgTable("usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  storageUsed: integer("storage_used").notNull().default(0),
  projectsCount: integer("projects_count").notNull().default(0),
  designFilesCount: integer("design_files_count").notNull().default(0),
  versionCount: integer("version_count").notNull().default(0),
  componentCount: integer("component_count").notNull().default(0),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Usage = typeof usage.$inferSelect;

// ── User Credits ─────────────────────────────────────────────────────────

export const userCredits = pgTable("user_credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  balance: real("balance").notNull().default(0),
  lifetimePurchased: real("lifetime_purchased").notNull().default(0),
  lifetimeUsed: real("lifetime_used").notNull().default(0),
  dailyUsed: real("daily_used").notNull().default(0),
  dailyResetAt: timestamp("daily_reset_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserCredits = typeof userCredits.$inferSelect;

export const CREDIT_TRANSACTION_TYPES = ["purchase", "usage", "usage_hold", "usage_refund", "grant"] as const;
export type CreditTransactionType = (typeof CREDIT_TRANSACTION_TYPES)[number];

export const creditTransactions = pgTable("credit_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  balanceAfter: real("balance_after").notNull(),
  description: text("description"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("credit_transactions_user_idx").on(t.userId, t.createdAt.desc()),
]);

export type CreditTransaction = typeof creditTransactions.$inferSelect;

export const CREDIT_HOLD_STATUSES = ["active", "released", "refunded", "cancelled"] as const;
export type CreditHoldStatus = (typeof CREDIT_HOLD_STATUSES)[number];

export const creditHolds = pgTable("credit_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  runId: uuid("run_id"),
  amount: real("amount").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("credit_holds_user_idx").on(t.userId),
  index("credit_holds_run_idx").on(t.runId),
]);

export type CreditHold = typeof creditHolds.$inferSelect;

// ── API Integrations ───────────────────────────────────────────────────────

export const apiIntegrations = pgTable("api_integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  apiKey: text("api_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ApiIntegration = typeof apiIntegrations.$inferSelect;

// ── Onboarding ────────────────────────────────────────────────────────────

export const ONBOARDING_STEPS = [
  "signup",
  "email_verification",
  "profile_name",
  "workspace",
  "finalizing",
  "complete",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_SESSION_STATUSES = ["active", "complete", "abandoned"] as const;
export type OnboardingSessionStatus = (typeof ONBOARDING_SESSION_STATUSES)[number];

export const ONBOARDING_TASK_STATUSES = ["not_started", "pending", "complete", "skipped", "failed"] as const;
export type OnboardingTaskStatus = (typeof ONBOARDING_TASK_STATUSES)[number];

export const onboardingSessions = pgTable("onboarding_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  status: text("status").notNull().default("active"),
  currentStep: text("current_step").notNull().default("signup"),
  emailVerificationStatus: text("email_verification_status").notNull().default("pending"),
  displayNameStatus: text("display_name_status").notNull().default("not_started"),
  workspaceStatus: text("workspace_status").notNull().default("not_started"),
  workspaceId: uuid("workspace_id"),
  workspaceName: text("workspace_name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  uniqueIndex("onboarding_sessions_user_id_idx").on(t.userId),
]);

export type OnboardingSession = typeof onboardingSessions.$inferSelect;
export const ONBOARDING_TOTAL_STEPS = ONBOARDING_STEPS.length;

// ── Projects ───────────────────────────────────────────────────────────────

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  workspaceId: uuid("workspace_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  coverUrl: text("cover_url"),
  color: text("color").notNull().default("#8b5cf6"),
  kind: text("kind").notNull().default("cortardo"),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("projects_workspace_idx").on(t.workspaceId, t.isArchived),
]);

export type Project = typeof projects.$inferSelect;

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kind: z.literal("cortardo").default("cortardo"),
});


export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  coverUrl: z.string().url().max(1000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isArchived: z.boolean().optional(),
});

// ── Project Branches ───────────────────────────────────────────────────────

export const branches = pgTable("branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("branches_project_name_idx").on(t.projectId, t.name),
  index("branches_project_idx").on(t.projectId),
]);

export type Branch = typeof branches.$inferSelect;

export const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// ── Project Members ────────────────────────────────────────────────────────

export const PROJECT_ROLES = ["owner", "editor", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const projectMembers = pgTable("project_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull().default("editor"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("project_member_idx").on(t.projectId, t.userId),
]);

export type ProjectMember = typeof projectMembers.$inferSelect;

// ── Design Files ──────────────────────────────────────────────────────────

export const DESIGN_FILE_TYPES = ["design", "prototype", "whiteboard"] as const;
export type DesignFileType = (typeof DESIGN_FILE_TYPES)[number];

export const designFiles = pgTable("design_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("design"),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  canvasWidth: integer("canvas_width").notNull().default(1440),
  canvasHeight: integer("canvas_height").notNull().default(900),
  version: integer("version").notNull().default(1),
  isFavorited: boolean("is_favorited").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("design_files_project_idx").on(t.projectId, t.isArchived),
  index("design_files_workspace_idx").on(t.workspaceId),
]);

export type DesignFile = typeof designFiles.$inferSelect;

export const createDesignFileSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(DESIGN_FILE_TYPES).default("design"),
  description: z.string().max(2000).optional(),
  canvasWidth: z.number().int().min(1).max(10000).optional(),
  canvasHeight: z.number().int().min(1).max(10000).optional(),
});

export const updateDesignFileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  thumbnailUrl: z.string().url().max(1000).nullable().optional(),
  canvasWidth: z.number().int().min(1).max(10000).optional(),
  canvasHeight: z.number().int().min(1).max(10000).optional(),
  isFavorited: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Design Versions ────────────────────────────────────────────────────────

export const designVersions = pgTable("design_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  designFileId: uuid("design_file_id").notNull().references(() => designFiles.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  data: jsonb("data").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqueFileVersion: uniqueIndex("design_version_unique").on(t.designFileId, t.versionNumber),
}));

export type DesignVersion = typeof designVersions.$inferSelect;

export const createDesignVersionSchema = z.object({
  description: z.string().max(500).optional(),
});

// ── Canvases (pages within a design file) ─────────────────────────────────

export const canvases = pgTable("canvases", {
  id: uuid("id").primaryKey().defaultRandom(),
  designFileId: uuid("design_file_id").notNull().references(() => designFiles.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Canvas 1"),
  orderIndex: integer("order_index").notNull().default(0),
  backgroundColor: text("background_color").notNull().default("#ffffff"),
  width: integer("width").notNull().default(1440),
  height: integer("height").notNull().default(900),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("canvases_design_file_idx").on(t.designFileId, t.orderIndex),
]);

export type Canvas = typeof canvases.$inferSelect;

export const createCanvasSchema = z.object({
  name: z.string().min(1).max(200).default("Canvas 1"),
  backgroundColor: z.string().default("#ffffff"),
  width: z.number().int().min(1).max(10000).default(1440),
  height: z.number().int().min(1).max(10000).default(900),
});

export const updateCanvasSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  orderIndex: z.number().int().min(0).optional(),
  backgroundColor: z.string().optional(),
  width: z.number().int().min(1).max(10000).optional(),
  height: z.number().int().min(1).max(10000).optional(),
});

// ── Layers (design elements on a canvas) ───────────────────────────────────

export const LAYER_TYPES = ["frame", "group", "text", "shape", "image", "svg", "component", "instance", "line", "ellipse", "rectangle", "polygon", "star", "vector", "boolean_operation"] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const layers = pgTable("layers", {
  id: uuid("id").primaryKey().defaultRandom(),
  designFileId: uuid("design_file_id").notNull().references(() => designFiles.id, { onDelete: "cascade" }),
  canvasId: uuid("canvas_id").notNull().references(() => canvases.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  name: text("name").notNull().default("Layer"),
  type: text("type").notNull().default("rectangle"),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  width: real("width").notNull().default(100),
  height: real("height").notNull().default(100),
  rotation: real("rotation").notNull().default(0),
  opacity: real("opacity").notNull().default(1),
  visible: boolean("visible").notNull().default(true),
  locked: boolean("locked").notNull().default(false),
  zIndex: integer("z_index").notNull().default(0),
  properties: jsonb("properties").$type<Record<string, unknown>>().default({}).notNull(),
  styles: jsonb("styles").$type<{
    fills?: Array<{ type: string; color?: string; opacity?: number }>;
    strokes?: Array<{ color: string; width: number }>;
    shadows?: Array<{ type: string; color: string; offsetX: number; offsetY: number; blur: number; spread: number }>;
    blurs?: Array<{ type: string; radius: number }>;
    cornerRadius?: number;
    borderRadius?: { topLeft?: number; topRight?: number; bottomLeft?: number; bottomRight?: number };
    opacity?: number;
  }>().default({}).notNull(),
  exportSettings: jsonb("export_settings").$type<Array<{ format: string; suffix: string; constraint?: { type: string; value: number } }>>().default([]).notNull(),
  componentId: uuid("component_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("layers_canvas_idx").on(t.canvasId, t.zIndex),
  index("layers_parent_idx").on(t.parentId),
  index("layers_design_file_idx").on(t.designFileId),
]);

export type Layer = typeof layers.$inferSelect;

export const layerPropertiesSchema = z.object({
  name: z.string().min(1).max(200).default("Layer"),
  type: z.enum(LAYER_TYPES).default("rectangle"),
  x: z.number().default(0),
  y: z.number().default(0),
  width: z.number().default(100),
  height: z.number().default(100),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  properties: z.record(z.unknown()).default({}),
  styles: z.record(z.unknown()).default({}),
});

// ── Component Sets (reusable component libraries) ─────────────────────────

export const componentSets = pgTable("component_sets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("component_sets_workspace_idx").on(t.workspaceId),
]);

export type ComponentSet = typeof componentSets.$inferSelect;

// ── Components ────────────────────────────────────────────────────────────

export const components = pgTable("components", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicId: text("public_id").notNull().unique(),
  componentSetId: uuid("component_set_id").references(() => componentSets.id, { onDelete: "set null" }),
  designFileId: uuid("design_file_id").references(() => designFiles.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("component"),
  properties: jsonb("properties").$type<{
    variants?: Array<{ name: string; values: Record<string, string> }>;
    variantProperties?: string[];
    defaultVariant?: string;
  }>().default({}).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("components_workspace_idx").on(t.workspaceId),
  index("components_set_idx").on(t.componentSetId),
]);

export type Component = typeof components.$inferSelect;

export const createComponentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  properties: z.record(z.unknown()).optional(),
});

export const updateComponentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  properties: z.record(z.unknown()).optional(),
  thumbnailUrl: z.string().url().max(1000).nullable().optional(),
});

// ── Assets (uploaded images, icons, fonts) ──────────────────────────────

export const ASSET_TYPES = ["image", "font", "icon", "illustration", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const assets = pgTable("assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  designFileId: uuid("design_file_id").references(() => designFiles.id, { onDelete: "set null" }),
  uploaderId: uuid("uploader_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("image"),
  url: text("url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  size: integer("size").notNull().default(0),
  mimeType: text("mime_type"),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("assets_workspace_idx").on(t.workspaceId),
  index("assets_design_file_idx").on(t.designFileId),
]);

export type Asset = typeof assets.$inferSelect;

// ── Design Tokens ─────────────────────────────────────────────────────────

export const TOKEN_TYPES = ["color", "typography", "spacing", "radius", "shadow", "opacity", "font_family", "font_weight", "line_height", "letter_spacing"] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

export const designTokens = pgTable("design_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  value: jsonb("value").notNull(),
  description: text("description"),
  category: text("category"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("design_token_name_type_idx").on(t.workspaceId, t.name, t.type),
]);

export type DesignToken = typeof designTokens.$inferSelect;

export const createDesignTokenSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(TOKEN_TYPES),
  value: z.union([z.string(), z.number(), z.record(z.unknown())]),
  description: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
});

export const updateDesignTokenSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(TOKEN_TYPES).optional(),
  value: z.union([z.string(), z.number(), z.record(z.unknown())]).optional(),
  description: z.string().max(500).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
});

// ── Comments ──────────────────────────────────────────────────────────────

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  designFileId: uuid("design_file_id").notNull().references(() => designFiles.id, { onDelete: "cascade" }),
  canvasId: uuid("canvas_id").references(() => canvases.id, { onDelete: "cascade" }),
  layerId: uuid("layer_id").references(() => layers.id, { onDelete: "set null" }),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
  x: real("x"),
  y: real("y"),
  resolved: boolean("resolved").notNull().default(false),
  resolvedById: uuid("resolved_by_id"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("comments_design_file_idx").on(t.designFileId, t.createdAt),
  index("comments_canvas_idx").on(t.canvasId),
]);

export type Comment = typeof comments.$inferSelect;

export const commentReplies = pgTable("comment_replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  commentId: uuid("comment_id").notNull().references(() => comments.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("comment_replies_comment_idx").on(t.commentId),
]);

export type CommentReply = typeof commentReplies.$inferSelect;

export const createCommentSchema = z.object({
  body: z.string().min(1).max(5000),
  layerId: z.string().uuid().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  pinned: z.boolean().optional(),
});

export const updateCommentSchema = z.object({
  body: z.string().min(1).max(5000).optional(),
  resolved: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export const createCommentReplySchema = z.object({
  body: z.string().min(1).max(5000),
});

// ── Design Shares ──────────────────────────────────────────────────────────

export const SHARE_ROLES = ["viewer", "editor"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

export const designShares = pgTable("design_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  designFileId: uuid("design_file_id").notNull().references(() => designFiles.id, { onDelete: "cascade" }),
  shareToken: text("share_token").notNull().unique(),
  role: text("role").notNull().default("viewer"),
  password: text("password"),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("design_shares_file_idx").on(t.designFileId),
]);

export type DesignShare = typeof designShares.$inferSelect;

export const createDesignShareSchema = z.object({
  role: z.enum(SHARE_ROLES).default("viewer"),
  password: z.string().min(1).max(100).optional(),
  expiresAt: z.coerce.date().optional(),
});

// ── Export Presets ─────────────────────────────────────────────────────────

export const EXPORT_FORMATS = ["png", "jpg", "svg", "pdf", "webp"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const exportPresets = pgTable("export_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  name: text("name").notNull(),
  format: text("format").notNull().default("png"),
  scale: real("scale").notNull().default(1),
  suffix: text("suffix").default(""),
  quality: integer("quality").default(100),
  includeBackground: boolean("include_background").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("export_presets_workspace_idx").on(t.workspaceId),
]);

export type ExportPreset = typeof exportPresets.$inferSelect;

// ── Notifications ─────────────────────────────────────────────────────────

export const NOTIFICATION_TYPES = ["comment", "mention", "share", "invite", "version", "approval"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  read: boolean("read").notNull().default(false),
  designFileId: uuid("design_file_id"),
  projectId: uuid("project_id"),
  commentId: uuid("comment_id"),
  actorId: uuid("actor_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("notifications_user_idx").on(t.userId, t.read, t.createdAt.desc()),
]);

export type Notification = typeof notifications.$inferSelect;

// ── Activity Log ──────────────────────────────────────────────────────────

export const activityLogs = pgTable("activity_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  userId: uuid("user_id"),
  projectId: uuid("project_id"),
  designFileId: uuid("design_file_id"),
  action: text("action").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("activity_logs_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
  index("activity_logs_design_file_idx").on(t.designFileId),
]);

export type ActivityLog = typeof activityLogs.$inferSelect;

// ── Plugins ────────────────────────────────────────────────────────────────

export const plugins = pgTable("plugins", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  iconUrl: text("icon_url"),
  manifest: jsonb("manifest").$type<Record<string, unknown>>().default({}).notNull(),
  isBuiltIn: boolean("is_built_in").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Plugin = typeof plugins.$inferSelect;

export const pluginInstallations = pgTable("plugin_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  pluginId: uuid("plugin_id").notNull().references(() => plugins.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  installedBy: uuid("installed_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniquePluginInstall: uniqueIndex("plugin_install_unique").on(t.pluginId, t.workspaceId),
}));

export type PluginInstallation = typeof pluginInstallations.$inferSelect;

// ── Audit Log ──────────────────────────────────────────────────────────────

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  action: text("action").notNull(),
  details: text("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;

// ── GitHub App Integration ────────────────────────────────────────────────

export const githubInstallations = pgTable("github_installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  installationId: text("installation_id").notNull().unique(),
  accountLogin: text("account_login"),
  accountType: text("account_type"),
  repositorySelection: text("repository_selection").notNull().default("selected"),
  suspendedAt: timestamp("suspended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("github_installations_workspace_idx").on(t.workspaceId),
]);

export type GithubInstallation = typeof githubInstallations.$inferSelect;
export type NewGithubInstallation = typeof githubInstallations.$inferInsert;

export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull().default("github"),
  externalId: text("external_id"),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  cloneUrl: text("clone_url"),
  installationId: text("installation_id"),
  isPrivate: boolean("is_private").notNull().default(true),
  reviewEnabled: boolean("review_enabled").notNull().default(true),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}).notNull(),
  indexedAt: timestamp("indexed_at"),
  lastReviewedAt: timestamp("last_reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("repositories_workspace_full_name_idx").on(t.workspaceId, t.provider, t.fullName),
  index("repositories_installation_idx").on(t.installationId),
  index("repositories_workspace_idx").on(t.workspaceId),
]);

export type Repository = typeof repositories.$inferSelect;
export type NewRepository = typeof repositories.$inferInsert;

export const repositoryCodegraphs = pgTable("repository_codegraphs", {
  repositoryId: uuid("repository_id")
    .primaryKey()
    .references(() => repositories.id, { onDelete: "cascade" }),
  commitSha: text("commit_sha"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  files: jsonb("files").$type<CodeGraphFile[]>().notNull().default([]),
  connections: jsonb("connections").$type<CodeGraphConnection[]>().notNull().default([]),
  symbols: jsonb("symbols").$type<CodeGraphSymbol[]>().notNull().default([]),
  symbolEdges: jsonb("symbol_edges").$type<CodeGraphSymbolEdge[]>().notNull().default([]),
  knowledge: jsonb("knowledge").$type<Array<{ path: string; content: string }>>().notNull().default([]),
  fileCount: integer("file_count").notNull().default(0),
  generatedAt: timestamp("generated_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type RepositoryCodegraph = typeof repositoryCodegraphs.$inferSelect;
export type NewRepositoryCodegraph = typeof repositoryCodegraphs.$inferInsert;

export const repositoryCodeFiles = pgTable("repository_code_files", {
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  contentHash: text("content_hash").notNull(),
  language: text("language").notNull(),
  kind: text("kind").notNull(),
  loc: integer("loc").notNull().default(0),
  parsed: jsonb("parsed").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.repositoryId, t.path] }),
]);

export type RepositoryCodeFile = typeof repositoryCodeFiles.$inferSelect;
export type NewRepositoryCodeFile = typeof repositoryCodeFiles.$inferInsert;

export const pullRequests = pgTable("pull_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id").notNull().references(() => repositories.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title"),
  body: text("body"),
  author: text("author"),
  baseRef: text("base_ref"),
  headRef: text("head_ref"),
  baseSha: text("base_sha"),
  headSha: text("head_sha"),
  state: text("state").notNull().default("open"),
  url: text("url"),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  changedFiles: integer("changed_files").notNull().default(0),
  providerData: jsonb("provider_data").$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pull_requests_repository_number_idx").on(t.repositoryId, t.number),
  index("pull_requests_repository_idx").on(t.repositoryId),
]);

export type PullRequest = typeof pullRequests.$inferSelect;
export type NewPullRequest = typeof pullRequests.$inferInsert;

export const reviewRuns = pgTable("review_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id"),
  repositoryId: uuid("repository_id"),
  pullRequestId: uuid("pull_request_id"),
  userId: uuid("user_id"),
  trigger: text("trigger").notNull().default("manual"),
  status: text("status").notNull().default("queued"),
  title: text("title"),
  instructions: text("instructions"),
  model: text("model"),
  /** Reviewed commit; enables idempotency + cache keys. */
  headSha: text("head_sha"),
  engineVersion: text("engine_version"),
  pullRequestNumber: integer("pull_request_number"),
  /** In-memory queue lease (recovered on restart when expired). */
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  heartbeatAt: timestamp("heartbeat_at"),
  /** Fencing generation; every claim increments it (3.3). */
  leaseGeneration: integer("lease_generation").notNull().default(0),
  /** pending | published | failed — set by the publisher (3.3). */
  publishState: text("publish_state").notNull().default("pending"),
  publishAttempts: integer("publish_attempts").notNull().default(0),
  publishError: text("publish_error"),
  publishedReviewId: text("published_review_id"),
  plan: jsonb("plan").$type<Record<string, unknown>>().default({}).notNull(),
  summary: text("summary"),
  stats: jsonb("stats").$type<Record<string, unknown>>().default({}).notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  creditsHeld: real("credits_held").notNull().default(0),
  creditsSettled: real("credits_settled").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("review_runs_repository_idx").on(t.repositoryId),
  index("review_runs_status_idx").on(t.status),
  uniqueIndex("review_runs_active_head_idx")
    .on(t.repositoryId, t.headSha, t.engineVersion)
    .where(sql`${t.status} in ('queued','running')`),
]);

export type ReviewRun = typeof reviewRuns.$inferSelect;
export type NewReviewRun = typeof reviewRuns.$inferInsert;

export const reviewFindings = pgTable("review_findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  repositoryId: uuid("repository_id"),
  workspaceId: uuid("workspace_id"),
  findingKey: text("finding_key").notNull(),
  path: text("path"),
  line: integer("line"),
  category: text("category"),
  severity: text("severity"),
  verdict: text("verdict"),
  confidence: real("confidence").notNull().default(0),
  title: text("title").notNull(),
  detail: text("detail"),
  evidence: jsonb("evidence").$type<unknown[]>().default([]).notNull(),
  models: jsonb("models").$type<Record<string, unknown>>().default({}).notNull(),
  fix: jsonb("fix").$type<Record<string, unknown>>().default({}).notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("review_findings_run_idx").on(t.runId),
  index("review_findings_repository_idx").on(t.repositoryId),
  uniqueIndex("review_findings_run_key_idx").on(t.runId, t.findingKey),
]);

export type ReviewFinding = typeof reviewFindings.$inferSelect;
export type NewReviewFinding = typeof reviewFindings.$inferInsert;

/**
 * Review cache. Every key embeds engine/prompt/tool/model versions and content
 * hashes, so deploys and model changes invalidate entries implicitly.
 */
export const reviewCacheEntries = pgTable("review_cache_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  cacheKey: text("cache_key").notNull().unique(),
  kind: text("kind").notNull(),
  engineVersion: text("engine_version"),
  promptVersion: text("prompt_version"),
  toolVersion: text("tool_version"),
  modelId: text("model_id"),
  repoFullName: text("repo_full_name"),
  headSha: text("head_sha"),
  payload: jsonb("payload").$type<unknown>(),
  meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
  hits: integer("hits").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("review_cache_kind_idx").on(t.kind),
  index("review_cache_repo_idx").on(t.repoFullName),
  index("review_cache_expires_idx").on(t.expiresAt),
]);

export type ReviewCacheEntry = typeof reviewCacheEntries.$inferSelect;
export type NewReviewCacheEntry = typeof reviewCacheEntries.$inferInsert;

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("github"),
  event: text("event").notNull(),
  deliveryId: text("delivery_id").notNull().unique(),
  payloadHash: text("payload_hash"),
  status: text("status").notNull().default("received"),
  error: text("error"),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
}, (t) => [
  index("webhook_deliveries_event_idx").on(t.event),
  index("webhook_deliveries_received_idx").on(t.receivedAt.desc()),
]);

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;

// ── Cortardo Bot memory ──────────────────────────────────────────────────────
// Workspace-scoped review rules, learnings from feedback, path exclusions and
// the workspace configuration consumed by the review runner.

export const repositoryRules = pgTable("repository_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
  glob: text("glob"),
  instruction: text("instruction").notNull(),
  scope: text("scope").notNull().default("All repositories"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("repository_rules_workspace_idx").on(t.workspaceId),
  index("repository_rules_repository_idx").on(t.repositoryId),
]);

export type RepositoryRule = typeof repositoryRules.$inferSelect;
export type NewRepositoryRule = typeof repositoryRules.$inferInsert;

export const repositoryLearnings = pgTable("repository_learnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  scope: text("scope").notNull().default("All repositories"),
  source: text("source").notNull().default("manual"),
  accepted: integer("accepted").notNull().default(0),
  rejected: integer("rejected").notNull().default(0),
  findingKey: text("finding_key"),
  path: text("path"),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("repository_learnings_workspace_idx").on(t.workspaceId),
  index("repository_learnings_repository_idx").on(t.repositoryId),
]);

export type RepositoryLearning = typeof repositoryLearnings.$inferSelect;
export type NewRepositoryLearning = typeof repositoryLearnings.$inferInsert;

export const botSettings = pgTable("bot_settings", {
  workspaceId: uuid("workspace_id").primaryKey().references(() => workspaces.id, { onDelete: "cascade" }),
  commitReviews: jsonb("commit_reviews").$type<CommitReviewSettings>().default(COMMIT_REVIEW_DEFAULTS).notNull(),
  settings: jsonb("settings").$type<BotWorkspaceConfig>().default(BOT_WORKSPACE_DEFAULTS).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BotSettings = typeof botSettings.$inferSelect;
export type NewBotSettings = typeof botSettings.$inferInsert;

export const botExclusions = pgTable("bot_exclusions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  repositoryId: uuid("repository_id").references(() => repositories.id, { onDelete: "cascade" }),
  pattern: text("pattern").notNull(),
  note: text("note"),
  enabled: boolean("enabled").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("bot_exclusions_workspace_idx").on(t.workspaceId),
  index("bot_exclusions_repository_idx").on(t.repositoryId),
]);

export type BotExclusion = typeof botExclusions.$inferSelect;
export type NewBotExclusion = typeof botExclusions.$inferInsert;

export const createBotRuleSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  repositoryId: z.string().uuid().nullish(),
  instruction: z.string().trim().min(3, "Rule must be at least 3 characters").max(2000),
  glob: z.string().trim().max(500).nullish(),
  enabled: z.boolean().optional(),
});

export const updateBotRuleSchema = z.object({
  instruction: z.string().trim().min(3).max(2000).optional(),
  glob: z.string().trim().max(500).nullish(),
  repositoryId: z.string().uuid().nullish(),
  enabled: z.boolean().optional(),
});

export const BOT_LEARNING_SOURCES = ["feedback", "rule", "manual"] as const;

export const createBotLearningSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  repositoryId: z.string().uuid().nullish(),
  text: z.string().trim().min(3, "Learning must be at least 3 characters").max(2000),
  source: z.enum(BOT_LEARNING_SOURCES).optional(),
  active: z.boolean().optional(),
});

export const updateBotLearningSchema = z.object({
  text: z.string().trim().min(3).max(2000).optional(),
  repositoryId: z.string().uuid().nullish(),
  active: z.boolean().optional(),
});

export const createBotExclusionSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  repositoryId: z.string().uuid().nullish(),
  pattern: z.string().trim().min(1, "Pattern is required").max(500),
  note: z.string().trim().max(500).nullish(),
  enabled: z.boolean().optional(),
});

export const updateBotExclusionSchema = z.object({
  pattern: z.string().trim().min(1).max(500).optional(),
  note: z.string().trim().max(500).nullish(),
  repositoryId: z.string().uuid().nullish(),
  enabled: z.boolean().optional(),
});

const commitReviewPatchSchema = z
  .object({
    enabled: z.boolean(),
    reviewDirect: z.boolean(),
    scanDiffs: z.boolean(),
    checkMessages: z.boolean(),
    suggestFixes: z.boolean(),
    autoApplySafeFixes: z.boolean(),
    ignoreMergeCommits: z.boolean(),
    ignoreReleaseCommits: z.boolean(),
    maxCommitsPerRun: z.number().int().min(1).max(500),
  })
  .partial();

const pullRequestReviewPatchSchema = z
  .object({
    autoReview: z.boolean(),
    reviewDrafts: z.boolean(),
    reReviewOnPush: z.boolean(),
    inlineComments: z.boolean(),
    summaryComment: z.boolean(),
    requestChangesOnCritical: z.boolean(),
    ignoreGenerated: z.boolean(),
    skipBotsAndForks: z.boolean(),
    commentLimit: z.number().int().min(1).max(200),
  })
  .partial();

export const updateBotSettingsSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  commitReviews: commitReviewPatchSchema.optional(),
  settings: z
    .object({
      instructions: z.string().max(4000),
      pullRequests: pullRequestReviewPatchSchema,
    })
    .partial()
    .optional(),
});

export const updateRepositorySchema = z.object({
  reviewEnabled: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateRepositorySelectionSchema = z.object({
  externalIds: z.array(z.string().trim().min(1)).max(1000),
});

export const createIssueSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(256),
  body: z.string().max(20000).optional(),
});

export const createIssueCommentSchema = z.object({
  body: z.string().trim().min(1, "Comment body is required").max(20000),
});

export const PR_REVIEW_EVENTS = ["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const;

export const createPullRequestReviewSchema = z.object({
  body: z.string().max(20000).optional(),
  event: z.enum(PR_REVIEW_EVENTS).default("COMMENT"),
  comments: z
    .array(
      z.object({
        path: z.string().min(1),
        line: z.number().int().positive(),
        body: z.string().min(1).max(20000),
        side: z.enum(["LEFT", "RIGHT"]).default("RIGHT"),
      }),
    )
    .max(50)
    .optional(),
});

// ── Session Tables ─────────────────────────────────────────────────────────

export const sessionTable = pgTable("session", {
  sid: text("sid").primaryKey(),
  sess: json("sess").notNull(),
  expire: timestamp("expire", { precision: 6 }).notNull(),
}, (t) => ({
  expireIndex: index("IDX_session_expire").on(t.expire),
}));

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionId: text("session_id").notNull().unique(),
  userAgent: text("user_agent"),
  browser: text("browser"),
  os: text("os"),
  device: text("device"),
  ipAddress: text("ip_address"),
  location: text("location"),
  isCurrent: boolean("is_current").notNull().default(false),
  lastActiveAt: timestamp("last_active_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  userSessionsUserIdIdx: index("user_sessions_user_id_idx").on(t.userId),
  userSessionsSessionIdIdx: uniqueIndex("user_sessions_session_id_idx").on(t.sessionId),
}));

export type UserSession = typeof userSessions.$inferSelect;
export type NewUserSession = typeof userSessions.$inferInsert;
