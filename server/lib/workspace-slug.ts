import { db } from "../db";
import { workspaces } from "@shared/schema";

type Executor = Pick<typeof db, "select">;

const SUPPORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Generates a support code in the format XXXX-XXXX (uppercase letters and digits). */
export function generateSupportCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 8; i++) {
    chars.push(SUPPORT_CODE_ALPHABET[Math.floor(Math.random() * SUPPORT_CODE_ALPHABET.length)]);
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

/** Generates a support code that no existing workspace uses. */
export async function generateUniqueSupportCode(executor: Executor = db): Promise<string> {
  const rows = await executor.select({ supportCode: workspaces.supportCode }).from(workspaces);
  const taken = new Set(rows.map((r) => r.supportCode).filter(Boolean));
  for (let i = 0; i < 100; i++) {
    const code = generateSupportCode();
    if (!taken.has(code)) return code;
  }
  return generateSupportCode();
}

/** Converts a workspace name into a URL-safe slug. */
export function slugifyWorkspaceName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "workspace";
}

/** Returns a slug derived from the workspace name that no other workspace uses. */
export async function generateUniqueWorkspaceSlug(
  name: string,
  excludeWorkspaceId?: string,
  executor: Executor = db,
): Promise<string> {
  const base = slugifyWorkspaceName(name);
  const rows = await executor.select({ id: workspaces.id, slug: workspaces.slug }).from(workspaces);
  const taken = new Set(rows.filter((r) => r.id !== excludeWorkspaceId).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}
