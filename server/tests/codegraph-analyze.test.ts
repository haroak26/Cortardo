import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSources, kindOf } from "../lib/codegraph/analyze";

test("resolves TypeScript imports to repository files", async () => {
  const result = await analyzeSources([
    { path: "src/index.ts", content: "import { run } from './runner';\nimport type { Config } from './types';\nrun();\n" },
    { path: "src/runner.ts", content: "import type { Config } from './types';\nexport function run() { return 1; }\n" },
    { path: "src/types.ts", content: "export interface Config { name: string }\n" },
  ]);

  const edges = result.connections.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`);
  assert.ok(edges.includes("src/index.ts->src/runner.ts:imports"));
  assert.ok(edges.includes("src/index.ts->src/types.ts:imports"));
  assert.ok(edges.includes("src/runner.ts->src/types.ts:imports"));

  const index = result.files.find((file) => file.id === "src/index.ts");
  assert.equal(index?.language, "TypeScript");
  assert.equal(index?.kind, "source");
  assert.equal(index?.entry, true);
});

test("resolves index files and python-relative imports", async () => {
  const result = await analyzeSources([
    { path: "src/app/index.ts", content: "import { helper } from '../shared/helper';\nhelper();\n" },
    { path: "src/shared/helper.ts", content: "export function helper() { return 2; }\n" },
    { path: "pkg/app.py", content: "from .util import helper\nhelper()\n" },
    { path: "pkg/util.py", content: "def helper():\n    return 1\n" },
  ]);

  const edges = result.connections.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`);
  assert.ok(edges.includes("src/app/index.ts->src/shared/helper.ts:imports"));
  assert.ok(edges.includes("src/app/index.ts->src/shared/helper.ts:calls"));
  assert.ok(edges.includes("pkg/app.py->pkg/util.py:imports"));
  assert.ok(edges.includes("pkg/app.py->pkg/util.py:calls"));
});

test("links calls to a unique declaration in another file", async () => {
  const result = await analyzeSources([
    { path: "src/core.ts", content: "export function uniqueHelper() { return 3; }\n" },
    { path: "src/other.ts", content: "const value = uniqueHelper();\n" },
  ]);

  assert.ok(
    result.connections.some(
      (edge) => edge.source === "src/other.ts" && edge.target === "src/core.ts" && edge.kind === "calls",
    ),
  );
});

test("resolves tsconfig path aliases and dynamic imports", async () => {
  const result = await analyzeSources([
    {
      path: "client/tsconfig.json",
      content: `{
        // baseUrl is relative to this file
        "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } },
      }`,
    },
    { path: "client/src/lib/utils.ts", content: "export function cn() { return ''; }\n" },
    { path: "client/src/app/page.tsx", content: "import { cn } from '@/lib/utils';\nconst page = () => cn();\nimport('./lazy');\n" },
    { path: "client/src/app/lazy.ts", content: "export const lazy = 1;\n" },
    { path: "client/src/components/button.tsx", content: "export function Button() { return null; }\n" },
    { path: "client/src/app/form.tsx", content: "const mod = require('@/components/button');\nvoid mod;\n" },
  ]);

  const edges = result.connections.map((edge) => `${edge.source}->${edge.target}:${edge.kind}`);
  assert.ok(edges.includes("client/src/app/page.tsx->client/src/lib/utils.ts:imports"));
  assert.ok(edges.includes("client/src/app/page.tsx->client/src/app/lazy.ts:imports"));
  assert.ok(edges.includes("client/src/app/form.tsx->client/src/components/button.tsx:imports"));
});

test("extracts symbols, qualified names and symbol call edges", async () => {
  const result = await analyzeSources([
    {
      path: "src/service.ts",
      content: [
        "export class UserService {",
        "  load(id: string) {",
        "    return fetchUser(id);",
        "  }",
        "}",
        "export function fetchUser(id: string) { return id; }",
        "const helper = () => fetchUser('x');",
      ].join("\n"),
    },
  ]);

  const names = result.symbols.map((symbol) => `${symbol.qualifiedName}:${symbol.kind}`);
  assert.ok(names.includes("UserService:class"));
  assert.ok(names.includes("UserService.load:method"));
  assert.ok(names.includes("fetchUser:function"));
  assert.ok(names.includes("helper:function"));

  const userService = result.symbols.find((symbol) => symbol.qualifiedName === "UserService");
  assert.equal(userService?.exported, true);
  assert.equal(userService?.parent, null);
  const load = result.symbols.find((symbol) => symbol.qualifiedName === "UserService.load");
  assert.equal(load?.parent, userService?.id);
  assert.equal(load?.exported, true);

  const callEdges = result.symbolEdges.map((edge) => `${edge.source}->${edge.target}`);
  assert.ok(
    callEdges.some((edge) => edge.includes("UserService.load") && edge.endsWith("#fetchUser")),
    `expected load -> fetchUser, got ${callEdges.join(", ")}`,
  );
  assert.ok(
    callEdges.some((edge) => edge.includes("#helper") && edge.endsWith("#fetchUser")),
    `expected helper -> fetchUser, got ${callEdges.join(", ")}`,
  );
});

test("classifies test, config and docs files", async () => {
  assert.equal(kindOf("src/foo.test.ts"), "test");
  assert.equal(kindOf("tests/test_api.py"), "test");
  assert.equal(kindOf("package.json"), "config");
  assert.equal(kindOf("docs/guide.md"), "docs");
  assert.equal(kindOf("src/index.ts"), "source");
});
