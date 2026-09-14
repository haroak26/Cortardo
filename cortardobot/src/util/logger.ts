export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  scope?: string;
  sink?: (line: string) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = LEVELS[options.level ?? "warn"];
  const scope = options.scope;
  const sink = options.sink ?? ((line: string) => process.stderr.write(`${line}\n`));

  const emit = (lvl: Exclude<LogLevel, "silent">, message: string, meta?: Record<string, unknown>) => {
    if (LEVELS[lvl] < level) return;
    const prefix = scope ? `[cortado:${scope}]` : "[cortado]";
    const metaText = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    sink(`${prefix} ${lvl} ${message}${metaText}`);
  };

  return {
    debug: (message, meta) => emit("debug", message, meta),
    info: (message, meta) => emit("info", message, meta),
    warn: (message, meta) => emit("warn", message, meta),
    error: (message, meta) => emit("error", message, meta),
    child: (childScope) =>
      createLogger({
        level: options.level ?? "warn",
        scope: scope ? `${scope}:${childScope}` : childScope,
        sink,
      }),
  };
}

export const silentLogger: Logger = createLogger({ level: "silent" });
