import { promises as fs } from "node:fs";
import { CortadoEngine, type EngineOptions } from "./engine";
import { createLogger, type LogLevel } from "./util/logger";
import type { PullRequestInput } from "./types";

export interface CliOptions {
  input?: string;
  mode?: "dry" | "live";
  json: boolean;
  help: boolean;
}

const USAGE = `Cortado 2.0 — fast autonomous code review

Usage:
  npm run bot -- --input <pr.json> [--mode dry|live] [--json]

Input format:
  {
    "title": "Fix session ownership check",
    "body": "optional description",
    "files": [
      { "path": "server/auth/session.ts", "content": "<full head content>" },
      { "path": "server/auth/session.ts", "patch": "<unified diff>" }
    ],
    "repoRules": ["optional repository rules"]
  }

Modes:
  dry   fully deterministic, no AI API calls (default without CORTADO_AI_API_KEY)
  live  calls the configured OpenAI-compatible endpoint

Environment:
  CORTADO_AI_API_KEY       enables live mode
  CORTADO_AI_BASE_URL      default https://api.openai.com/v1
  CORTADO_MODEL_LUNA       default gpt-5.6-luna
  CORTADO_MODEL_TERRA      default gpt-5.6-terra
  CORTADO_MODEL_ASTRA      default gpt-6-astra
  CORTADO_LOG_LEVEL        debug | info | warn | error | silent
`;

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--input" || arg === "-i") options.input = argv[++index];
    else if (arg === "--mode") {
      const mode = argv[++index];
      if (mode === "dry" || mode === "live") options.mode = mode;
    } else if (!arg.startsWith("-") && !options.input) {
      options.input = arg;
    }
  }
  return options;
}

export function engineOptionsFor(options: CliOptions): EngineOptions {
  const engineOptions: EngineOptions = {
    logger: createLogger({ level: (process.env.CORTADO_LOG_LEVEL as LogLevel) ?? "warn", scope: "cli" }),
  };
  if (options.mode === "dry") engineOptions.mode = "dry";
  if (options.mode === "live") engineOptions.mode = "live";
  return engineOptions;
}

export interface CliIo {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (chunk) => {
    process.stdout.write(chunk);
  },
  stderr: (chunk) => {
    process.stderr.write(chunk);
  },
};

export async function runCli(
  argv: string[] = process.argv.slice(2),
  io: CliIo = DEFAULT_IO,
): Promise<number> {
  const options = parseArgs(argv);
  if (options.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (!options.input) {
    io.stderr(`Missing --input <pr.json>\n\n${USAGE}`);
    return 1;
  }
  let input: PullRequestInput;
  try {
    input = JSON.parse(await fs.readFile(options.input, "utf8")) as PullRequestInput;
  } catch (error) {
    io.stderr(`Could not read input: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let engine: CortadoEngine;
  try {
    engine = new CortadoEngine(engineOptionsFor(options));
  } catch (error) {
    io.stderr(`Could not start engine: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  const result = await engine.run(input);
  if (options.json) {
    io.stdout(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout(result.markdown);
  }
  return result.status === "completed" ? 0 : 1;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    });
}
