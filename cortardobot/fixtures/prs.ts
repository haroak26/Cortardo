import type { ChangedFileInput, PRSize, PRClassification, PullRequestInput } from "../src/types";
import { makeUnifiedDiff } from "../src/util/diff";

export interface PrFixture {
  id: string;
  description: string;
  pullRequest: PullRequestInput;
  supportFiles: Record<string, string>;
  expected: {
    classificationIncludes: PRClassification[];
    size: PRSize;
    ruleIds: string[];
    fixable: boolean;
    minCandidates: number;
  };
}

interface MutableFile {
  input: ChangedFileInput;
  finalContent: string;
}

function changed(
  path: string,
  oldContent: string,
  newContent: string,
  status: ChangedFileInput["status"] = "modified",
): MutableFile {
  return {
    input: {
      path,
      status,
      patch: makeUnifiedDiff(path, oldContent, newContent),
      content: newContent,
    },
    finalContent: newContent,
  };
}

function build(
  id: string,
  description: string,
  title: string,
  files: MutableFile[],
  supportFiles: Record<string, string>,
  expected: PrFixture["expected"],
  body = "",
): PrFixture {
  const sandboxFiles: Record<string, string> = { ...supportFiles };
  for (const file of files) sandboxFiles[file.input.path] = file.finalContent;
  return {
    id,
    description,
    pullRequest: { id, title, body, files: files.map((file) => file.input) },
    supportFiles: sandboxFiles,
    expected,
  };
}

function pad(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `const ${prefix}_${index} = ${index};`).join("\n");
}

const loginOld = `import { sessions } from "../db";

export function authorize(userId: string, sessionUserId: string): boolean {
  if (sessionUserId !== userId) {
    return false;
  }
  return true;
}
`;

const loginNew = `import { sessions } from "../db";

export function authorize(userId: string, sessionUserId: string): boolean {
  if (sessionUserId == userId) {
    return false;
  }
  return true;
}
`;

const adminOld = `import { Router } from "express";
import { requireAuth } from "../auth/middleware";

const router = Router();

router.get("/api/admin/users", requireAuth, listUsers);

export default router;
`;

const adminNew = `import { Router } from "express";
import { requireAuth } from "../auth/middleware";

const router = Router();

router.get("/api/admin/users", requireAuth, listUsers);
router.delete("/api/admin/users/:id", deleteUserHandler);

export default router;
`;

const repoOld = `import { db } from "../db";

export async function findUser(userId: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [userId]);
}
`;

const repoNew = `import { db } from "../db";

export async function findUser(userId: string) {
  return db.query(\`SELECT * FROM users WHERE id = \${userId}\`);
}
`;

const commentOld = `export function renderComment(el: HTMLElement, comment: { body: string }) {
  el.textContent = comment.body;
}
`;

const commentNew = `export function renderComment(el: HTMLElement, comment: { body: string }) {
  el.innerHTML = comment.body;
}
`;

const configOld = `export const config = {
  port: 3000,
  apiKey: process.env.API_KEY,
};
`;

const configNew = `export const config = {
  port: 3000,
  apiKey: "sk-live-abc123456789",
};
`;

const paginationOld = `export function sumLengths(items: string[]) {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i].length;
  }
  return total;
}
`;

const paginationNew = paginationOld.replace("i < items.length", "i <= items.length");

const profileOld = `import { fetchProfile } from "../services/profile";

export function loadProfile(id: string) {
  return fetchProfile(id).then((profile) => profile.name).catch(() => "unknown");
}
`;

const profileNew = `import { fetchProfile } from "../services/profile";

export function loadProfile(id: string) {
  return fetchProfile(id).then((profile) => profile.name);
}
`;

const reportOld = `import { db } from "../db";

export async function loadRows(ids: string[]) {
  const rows = [];
  for (const id of ids) {
    rows.push(await db.query("SELECT * FROM rows WHERE id = ?", [id]));
  }
  return rows;
}
`;

const reportNew = `import { db } from "../db";

export async function loadRows(ids: string[]) {
  const rows = ids.map(async (id) => await db.query("SELECT * FROM rows WHERE id = ?", [id]));
  return rows;
}
`;

const sessionOld = `export function createSession(userId: string, expiresIn: number) {
  return { userId, expiresIn };
}
`;

const sessionNew = `export function createSession(userId: string) {
  return { userId, expiresIn: 3600 };
}
`;

const loginTestOld = `import { authorize } from "../../server/auth/login";

test("accepts the session owner", () => {
  expect(authorize(1 as unknown as string, "1")).toBe(true);
});

test("rejects other users", () => {
  expect(authorize(2 as unknown as string, "1")).toBe(false);
});
`;

const loginTestNew = `import { authorize } from "../../server/auth/login";

test("accepts the session owner", () => {
  expect(authorize(1 as unknown as string, "1")).toBe(true);
});
`;

const rangeOld = `export function countMatches(items: number[], index: number) {
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === index) count++;
  }
  return count;
}
`;

const rangeNew = rangeOld.replace("i < items.length", "i <= items.length");

const feedOld = `export function paintFeed(el: HTMLElement, posts: Array<{ body: string }>) {
  el.textContent = posts.map((post) => post.body).join("");
}
`;

const feedNew = `export function paintFeed(el: HTMLElement, posts: Array<{ body: string }>) {
  el.innerHTML = posts.map((post) => post.body).join("");
}
`;

const loginSupport = `import { authorize } from "./login";

test("accepts the session owner", () => {
  expect(authorize(1 as unknown as string, "1")).toBe(true);
});
`;

const repoSupport = `import { findUser } from "./repository";

test("parameterizes the user lookup", async () => {
  await expect(findUser("1' OR '1'='1")).resolves.toBeDefined();
});
`;

const commentSupport = `import { renderComment } from "./Comment";

test("escapes comment html", () => {
  const el = document.createElement("div");
  renderComment(el, { body: "<img src=x onerror=alert(1)>" });
  expect(el.querySelector("img")).toBeNull();
});
`;

const paginationSupport = `import { sumLengths } from "./pagination";

test("sums without going out of bounds", () => {
  expect(sumLengths(["a", "bb"])).toBe(3);
});
`;

const profileSupport = `import { loadProfile } from "./profile";

test("survives a profile service failure", async () => {
  await expect(loadProfile("user-1")).resolves.toBeDefined();
});
`;

const sessionSupport = `import { createSession } from "./sessions";

test("creates a session with an expiry", () => {
  expect(createSession("user-1", 3600)).toEqual({ userId: "user-1", expiresIn: 3600 });
});
`;

export const FIXTURES: PrFixture[] = [
  build(
    "auth-weak-compare",
    "Session ownership check with loose equality",
    "Fix session ownership comparison",
    [changed("server/auth/session.ts", loginOld, loginNew)],
    { "server/auth/session.test.ts": loginSupport },
    {
      classificationIncludes: ["AUTH"],
      size: "tiny",
      ruleIds: ["auth-weak-comparison"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "auth-missing-route",
    "Sensitive admin route added without an auth guard",
    "Add admin user deletion endpoint",
    [changed("server/routes/admin.ts", adminOld, adminNew)],
    { "server/routes/admin.test.ts": `import router from "./admin";\ntest("rejects anonymous delete", () => {\n  expect(router).toBeDefined();\n});\n` },
    {
      classificationIncludes: ["API", "AUTH"],
      size: "tiny",
      ruleIds: ["auth-missing-check"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "sql-injection",
    "Template literal interpolated into a SQL statement",
    "Optimize user lookup",
    [changed("server/users/repository.ts", repoOld, repoNew)],
    { "server/users/repository.test.ts": repoSupport },
    {
      classificationIncludes: ["DATABASE"],
      size: "tiny",
      ruleIds: ["sql-injection"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "xss-innerhtml",
    "Untrusted comment body written through innerHTML",
    "Render comment bodies",
    [changed("client/components/Comment.tsx", commentOld, commentNew)],
    { "client/components/Comment.test.tsx": commentSupport },
    {
      classificationIncludes: ["UI"],
      size: "tiny",
      ruleIds: ["xss-unsafe-html"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "hardcoded-secret",
    "Live API key committed in source",
    "Simplify config setup",
    [changed("server/config.ts", configOld, configNew)],
    {},
    {
      classificationIncludes: ["CONFIG"],
      size: "tiny",
      ruleIds: ["hardcoded-secret"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "off-by-one",
    "Loop reads past the end of the array",
    "Tidy pagination helper",
    [changed("server/lib/pagination.ts", paginationOld, paginationNew)],
    { "server/lib/pagination.test.ts": paginationSupport },
    {
      classificationIncludes: [],
      size: "tiny",
      ruleIds: ["off-by-one-loop"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "unhandled-promise",
    "Promise chain without a rejection handler",
    "Streamline profile loading",
    [changed("server/api/profile.ts", profileOld, profileNew)],
    { "server/api/profile.test.ts": profileSupport },
    {
      classificationIncludes: ["API"],
      size: "tiny",
      ruleIds: ["unhandled-async-rejection"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "n-plus-one",
    "Sequential awaits inside a map",
    "Batch analytics row loading",
    [changed("server/analytics/report.ts", reportOld, reportNew)],
    {},
    {
      classificationIncludes: ["DATABASE", "PERFORMANCE"],
      size: "tiny",
      ruleIds: ["sequential-await-map"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "api-breaking",
    "Exported signature lost a parameter",
    "Simplify session creation",
    [changed("server/api/sessions.ts", sessionOld, sessionNew)],
    { "server/api/sessions.test.ts": sessionSupport },
    {
      classificationIncludes: ["API"],
      size: "tiny",
      ruleIds: ["api-breaking-signature"],
      fixable: true,
      minCandidates: 1,
    },
  ),
  build(
    "complex-multi",
    "Multi-area PR with eight planted defects",
    "Auth, database and UI overhaul",
    [
      changed("server/auth/login.ts", loginOld, `${loginNew}\n${pad("login_pad", 40)}\n`),
      changed("server/routes/admin.ts", adminOld, `${adminNew}\n${pad("admin_pad", 40)}\n`),
      changed("server/users/repo.ts", repoOld, `${repoNew}\n${pad("repo_pad", 40)}\n`),
      changed("client/components/Feed.tsx", feedOld, `${feedNew}\n${pad("feed_pad", 40)}\n`),
      changed("server/config.ts", configOld, `${configNew}\n${pad("config_pad", 40)}\n`),
      changed("server/lib/range.ts", rangeOld, `${rangeNew}\n${pad("range_pad", 40)}\n`),
      changed("server/api/profile.ts", profileOld, `${profileNew}\n${pad("profile_pad", 40)}\n`),
      changed("tests/auth/login.test.ts", loginTestOld, `${loginTestNew}\n${pad("test_pad", 40)}\n`),
    ],
    {
      "server/auth/session.test.ts": loginSupport,
      "server/users/repository.test.ts": repoSupport,
    },
    {
      classificationIncludes: ["AUTH", "CONFIG", "API"],
      size: "complex",
      ruleIds: [
        "auth-weak-comparison",
        "auth-missing-check",
        "sql-injection",
        "xss-unsafe-html",
        "hardcoded-secret",
        "off-by-one-loop",
        "unhandled-async-rejection",
        "removed-test-coverage",
      ],
      fixable: true,
      minCandidates: 5,
    },
  ),
];

export function fixtureFiles(fixture: PrFixture): Record<string, string> {
  return { ...fixture.supportFiles };
}

export function fixtureById(id: string): PrFixture {
  const fixture = FIXTURES.find((item) => item.id === id);
  if (!fixture) throw new Error(`unknown fixture: ${id}`);
  return fixture;
}
