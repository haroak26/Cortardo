/**
 * Lazy sandbox: provisions the real sandbox (E2B) only when a tool actually
 * needs it. A review with no reproduced defect never starts one.
 */
import type { ExecResult, RepoProfile, Sandbox } from "./types";

export class LazySandbox implements Sandbox {
  readonly id = "lazy";
  readonly root: string;
  private instance?: Sandbox;
  private starting?: Promise<Sandbox>;
  private failed?: string;

  constructor(
    private readonly factory: () => Promise<Sandbox>,
    private readonly init: (sandbox: Sandbox) => Promise<void>,
    root = "/home/user/repo",
  ) {
    this.root = root;
  }

  get ready(): boolean {
    return this.instance !== undefined;
  }

  get error(): string | undefined {
    return this.failed;
  }

  private async get(): Promise<Sandbox> {
    if (this.instance) return this.instance;
    if (this.failed) throw new Error(this.failed);
    this.starting ??= (async () => {
      const sandbox = await this.factory();
      await this.init(sandbox);
      this.instance = sandbox;
      return sandbox;
    })().catch((error) => {
      this.failed = error instanceof Error ? error.message : String(error);
      throw error;
    });
    return this.starting;
  }

  async prepare(): Promise<void> {
    await this.get();
  }

  async install(): Promise<void> {
    await this.get();
  }

  async profile(): Promise<RepoProfile> {
    const sandbox = await this.get();
    return sandbox.profile();
  }

  async exec(command: string, options?: Parameters<Sandbox["exec"]>[1]): Promise<ExecResult> {
    const sandbox = await this.get();
    return sandbox.exec(command, options);
  }

  async read(path: string): Promise<string> {
    const sandbox = await this.get();
    return sandbox.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    const sandbox = await this.get();
    await sandbox.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    const sandbox = await this.get();
    return sandbox.exists(path);
  }

  async list(dir?: string): Promise<string[]> {
    const sandbox = await this.get();
    return sandbox.list(dir);
  }

  async gitDiff(): Promise<string> {
    const sandbox = await this.get();
    return sandbox.gitDiff();
  }

  async startApp(options?: Parameters<Sandbox["startApp"]>[0]): Promise<{ url: string; stop: () => Promise<void> }> {
    const sandbox = await this.get();
    return sandbox.startApp(options);
  }

  async cleanup(): Promise<void> {
    if (this.instance) {
      await this.instance.cleanup().catch(() => undefined);
      this.instance = undefined;
    }
  }
}
