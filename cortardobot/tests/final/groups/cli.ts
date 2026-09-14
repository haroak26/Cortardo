import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { engineOptionsFor, parseArgs, runCli, type CliIo } from "../../../src/cli";
import { defineCases } from "../../exhaustive/types";

async function capture(run: (io: CliIo) => Promise<number>): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  };
  const code = await run(io);
  return { code, stdout, stderr };
}

async function writeTemp(content: string, extension = "json"): Promise<string> {
  const file = path.join(os.tmpdir(), `cortado-cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`);
  await fs.writeFile(file, content, "utf8");
  return file;
}

const TRIVIAL_PR = JSON.stringify({ title: "CLI trivial", files: [] });

export function buildCliGroup() {
  return defineCases("cli", [
    { name: "parseArgs accepts --help", run: () => assert.equal(parseArgs(["--help"]).help, true) },
    { name: "parseArgs accepts -h", run: () => assert.equal(parseArgs(["-h"]).help, true) },
    { name: "parseArgs accepts --json", run: () => assert.equal(parseArgs(["--json"]).json, true) },
    {
      name: "parseArgs accepts --input",
      run: () => assert.equal(parseArgs(["--input", "pr.json"]).input, "pr.json"),
    },
    {
      name: "parseArgs accepts -i",
      run: () => assert.equal(parseArgs(["-i", "pr.json"]).input, "pr.json"),
    },
    {
      name: "parseArgs accepts a positional path",
      run: () => assert.equal(parseArgs(["pr.json"]).input, "pr.json"),
    },
    {
      name: "parseArgs accepts --mode dry",
      run: () => assert.equal(parseArgs(["--mode", "dry"]).mode, "dry"),
    },
    {
      name: "parseArgs accepts --mode live",
      run: () => assert.equal(parseArgs(["--mode", "live"]).mode, "live"),
    },
    {
      name: "parseArgs ignores an unknown mode",
      run: () => assert.equal(parseArgs(["--mode", "quantum"]).mode, undefined),
    },
    {
      name: "parseArgs defaults are off",
      run: () => {
        const options = parseArgs([]);
        assert.equal(options.help, false);
        assert.equal(options.json, false);
        assert.equal(options.input, undefined);
      },
    },
    {
      name: "engineOptionsFor defaults to the environment",
      run: () => {
        const options = engineOptionsFor({ json: false, help: false });
        assert.equal(options.mode, undefined);
        assert.ok(options.logger);
      },
    },
    {
      name: "engineOptionsFor honours dry mode",
      run: () => assert.equal(engineOptionsFor({ json: false, help: false, mode: "dry" }).mode, "dry"),
    },
    {
      name: "engineOptionsFor honours live mode",
      run: () => assert.equal(engineOptionsFor({ json: false, help: false, mode: "live" }).mode, "live"),
    },
    {
      name: "runCli --help prints usage and exits zero",
      run: async () => {
        const { code, stdout } = await capture((io) => runCli(["--help"], io));
        assert.equal(code, 0);
        assert.match(stdout, /Cortado 2.0/);
      },
    },
    {
      name: "runCli without input reports usage",
      run: async () => {
        const { code, stderr } = await capture((io) => runCli([], io));
        assert.equal(code, 1);
        assert.match(stderr, /Missing --input/);
      },
    },
    {
      name: "runCli reports unreadable input",
      run: async () => {
        const { code, stderr } = await capture((io) => runCli(["--input", "/nonexistent/pr.json"], io));
        assert.equal(code, 1);
        assert.match(stderr, /Could not read input/);
      },
    },
    {
      name: "runCli rejects invalid JSON",
      run: async () => {
        const file = await writeTemp("{not json", "json");
        const { code, stderr } = await capture((io) => runCli(["--input", file], io));
        assert.equal(code, 1);
        assert.match(stderr, /Could not read input/);
      },
    },
    {
      name: "runCli prints the markdown report in dry mode",
      run: async () => {
        const file = await writeTemp(TRIVIAL_PR);
        const { code, stdout } = await capture((io) => runCli(["--input", file, "--mode", "dry"], io));
        assert.equal(code, 0);
        assert.match(stdout, /# Cortado Review/);
      },
    },
    {
      name: "runCli prints parseable JSON with --json",
      run: async () => {
        const file = await writeTemp(TRIVIAL_PR);
        const { code, stdout } = await capture((io) => runCli(["--input", file, "--mode", "dry", "--json"], io));
        assert.equal(code, 0);
        const parsed = JSON.parse(stdout) as { status: string; markdown: string };
        assert.equal(parsed.status, "completed");
        assert.match(parsed.markdown, /Cortado Review/);
      },
    },
    {
      name: "runCli reports live mode startup failure without a key",
      run: async () => {
        const file = await writeTemp(TRIVIAL_PR);
        const { code, stderr } = await capture((io) => runCli(["--input", file, "--mode", "live"], io));
        assert.equal(code, 1);
        assert.match(stderr, /Could not start engine/);
      },
    },
  ]);
}
