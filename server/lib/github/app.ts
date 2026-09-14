import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export interface GithubAppConfig {
  appId: string;
  slug: string;
  name: string;
  privateKey: string;
  webhookSecret: string | null;
}

let cachedConfig: GithubAppConfig | null | undefined;

/** GitHub private keys are often stored in env with literal \n sequences. */
export function normalizePrivateKey(value: string): string {
  const trimmed = value.trim().replace(/^"|"$/g, "");
  let key = trimmed.includes("\\n") ? trimmed.replace(/\\n/g, "\n") : trimmed;

  // Single-line PEMs (newlines stripped by the secret store) need rebuilding.
  if (!key.includes("\n")) {
    key = key.replace(/\r/g, "");
    const match = key.match(/^(-----BEGIN [^-]+-----)\s*([\s\S]*?)\s*(-----END [^-]+-----)$/);
    if (match) {
      const body = match[2].replace(/\s+/g, "");
      const lines = body.match(/.{1,64}/g) ?? [];
      key = `${match[1]}\n${lines.join("\n")}\n${match[3]}\n`;
    }
  }

  return key;
}

export function getGithubAppConfig(): GithubAppConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const appId = process.env.GITHUB_APP_ID?.trim();
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY?.trim();
  if (!appId || !privateKeyRaw) {
    cachedConfig = null;
    return cachedConfig;
  }

  const slug = (process.env.GITHUB_APP_SLUG || process.env.GITHUB_APP_NAME || "").trim();
  cachedConfig = {
    appId,
    slug,
    name: (process.env.GITHUB_APP_NAME || process.env.GITHUB_APP_SLUG || "Cortardo").trim(),
    privateKey: normalizePrivateKey(privateKeyRaw),
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET?.trim() || null,
  };
  return cachedConfig;
}

export function isGithubConfigured(): boolean {
  return getGithubAppConfig() !== null;
}

export class GithubNotConfiguredError extends Error {
  constructor() {
    super("GitHub App is not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.");
    this.name = "GithubNotConfiguredError";
  }
}

function requireConfig(): GithubAppConfig {
  const config = getGithubAppConfig();
  if (!config) throw new GithubNotConfiguredError();
  return config;
}

let appOctokit: Octokit | null = null;

/** App-level client (app JWT) for installation metadata and app endpoints. */
export function getAppOctokit(): Octokit {
  const config = requireConfig();
  if (!appOctokit) {
    appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId: config.appId, privateKey: config.privateKey },
    });
  }
  return appOctokit;
}

const installationClients = new Map<string, Octokit>();

/**
 * Installation-scoped client. @octokit/auth-app caches installation tokens
 * per client instance, so we keep one instance per installation id.
 */
export function getInstallationOctokit(installationId: string | number): Octokit {
  const config = requireConfig();
  const key = String(installationId);
  let client = installationClients.get(key);
  if (!client) {
    client = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: config.appId,
        privateKey: config.privateKey,
        installationId: Number(installationId),
      },
    });
    installationClients.set(key, client);
  }
  return client;
}

/** Drop a cached installation client (e.g. after suspend/delete). */
export function clearInstallationClient(installationId: string | number): void {
  installationClients.delete(String(installationId));
}

/** Short-lived installation token for git operations (clone/fetch). */
export async function getInstallationToken(installationId: string | number): Promise<string> {
  const config = requireConfig();
  const auth = createAppAuth({
    appId: config.appId,
    privateKey: config.privateKey,
    installationId: Number(installationId),
  });
  const { token } = await auth({ type: "installation" });
  return token;
}

/** Test hook: clears memoized config and clients. */
export function resetGithubClientCache(): void {
  cachedConfig = undefined;
  appOctokit = null;
  installationClients.clear();
}
