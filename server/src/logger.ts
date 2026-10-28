/**
 * Minimal structured logger. Callers must only pass operational metadata
 * (ids, status codes, durations) — never message content, passwords,
 * cookies, tokens or API keys.
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
}

function write(level: Level, event: string, fields?: Fields): void {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const logger: Logger = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
