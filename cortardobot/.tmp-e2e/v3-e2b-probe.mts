import { Sandbox } from "e2b";

const sbx = await Sandbox.create("cortardo-review-v1", { apiKey: process.env.E2B_API_KEY, timeoutMs: 300_000 });
console.log("sandbox:", sbx.sandboxId);

async function check(label: string, command: string, user?: string) {
  try {
    const r = await sbx.commands.run(command, { timeoutMs: 120_000, ...(user ? { user } : {}) });
    console.log(`OK   ${label}: ${(r.stdout ?? "").trim().split("\n").slice(0, 2).join(" | ").slice(0, 160)}`);
  } catch (error: any) {
    console.log(`FAIL ${label}: ${String(error?.stderr || error?.message || error).slice(0, 300)}`);
  }
}

await check("node", "node --version");
await check("npm", "npm --version");
await check("git", "git --version");
await check("playwright", `NODE_PATH=$(npm root -g) node -e "const p=require('playwright'); console.log(typeof p.chromium)"`);
await check("chromium", "ls /opt/ms-playwright 2>/dev/null || ls ~/.cache/ms-playwright 2>/dev/null");
await check("whoami", "whoami");
await check("curl", "curl --version | head -n1");
await sbx.kill();
console.log("done");
