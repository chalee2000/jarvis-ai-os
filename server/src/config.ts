import path from "node:path";

export type NodeEnv = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnv;
  isProduction: boolean;
  host: string;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  /** Allowed browser origins for state-changing requests. The first one is canonical. */
  appOrigins: string[];
  mockMode: boolean;
  anthropicApiKey: string | undefined;
  anthropicModel: string | undefined;
  /** Approximate token budget for conversation history sent to Claude. */
  contextTokenBudget: number;
  trustProxyHops: number;
  clientDistDir: string;
}

/**
 * Thrown when required configuration is missing or invalid. The message lists
 * variable names and problems only — never the values themselves.
 */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`การตั้งค่าไม่ครบหรือไม่ถูกต้อง:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER_SECRETS = [
  "change-me",
  "changeme",
  "replace-me",
  "your-secret",
  "secret",
];

function readString(env: Env, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseIntInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}

function normalizeOrigin(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function isDatabaseUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//.test(value);
}

/** Only DATABASE_URL is needed by the migration/admin CLIs. */
export function loadDatabaseUrl(env: Env = process.env): string {
  const databaseUrl = readString(env, "DATABASE_URL");
  if (!databaseUrl) throw new ConfigError(["DATABASE_URL: ต้องกำหนด"]);
  if (!isDatabaseUrl(databaseUrl)) {
    throw new ConfigError(["DATABASE_URL: ต้องขึ้นต้นด้วย postgres:// หรือ postgresql://"]);
  }
  return databaseUrl;
}

export function loadConfig(env: Env = process.env): AppConfig {
  const problems: string[] = [];

  const rawNodeEnv = readString(env, "NODE_ENV") ?? "development";
  if (!["development", "test", "production"].includes(rawNodeEnv)) {
    problems.push("NODE_ENV: ต้องเป็น development, test หรือ production");
  }
  const nodeEnv = rawNodeEnv as NodeEnv;
  const isProduction = nodeEnv === "production";

  const port = parseIntInRange(readString(env, "PORT"), 3000, 1, 65535);
  if (port === undefined) problems.push("PORT: ต้องเป็นตัวเลข 1-65535");

  const databaseUrl = readString(env, "DATABASE_URL");
  if (!databaseUrl) {
    problems.push("DATABASE_URL: ต้องกำหนด");
  } else if (!isDatabaseUrl(databaseUrl)) {
    problems.push("DATABASE_URL: ต้องขึ้นต้นด้วย postgres:// หรือ postgresql://");
  }

  const sessionSecret = readString(env, "SESSION_SECRET");
  if (!sessionSecret) {
    problems.push("SESSION_SECRET: ต้องกำหนด (สุ่มอย่างน้อย 32 ตัวอักษร)");
  } else if (sessionSecret.length < 32) {
    problems.push("SESSION_SECRET: ต้องยาวอย่างน้อย 32 ตัวอักษร");
  } else if (
    isProduction &&
    PLACEHOLDER_SECRETS.some((p) => sessionSecret.toLowerCase().includes(p))
  ) {
    problems.push("SESSION_SECRET: ห้ามใช้ค่าตัวอย่างใน production");
  }

  // APP_ORIGIN may list several origins separated by commas (useful in local dev).
  // On Render, RENDER_EXTERNAL_URL is used when APP_ORIGIN is not set.
  const rawOrigins =
    readString(env, "APP_ORIGIN") ??
    (isProduction ? readString(env, "RENDER_EXTERNAL_URL") : undefined) ??
    (isProduction ? undefined : "http://localhost:5173,http://localhost:3000");
  const appOrigins: string[] = [];
  if (!rawOrigins) {
    problems.push("APP_ORIGIN: ต้องกำหนดใน production (เช่น https://jarvis-v1-web.onrender.com)");
  } else {
    for (const part of rawOrigins.split(",")) {
      const origin = normalizeOrigin(part.trim());
      if (!origin) {
        problems.push("APP_ORIGIN: ต้องเป็น URL ที่ถูกต้อง เช่น https://example.com");
      } else if (isProduction && !origin.startsWith("https://")) {
        problems.push("APP_ORIGIN: ต้องเป็น https:// ใน production");
      } else {
        appOrigins.push(origin);
      }
    }
  }

  const rawMock = readString(env, "MOCK_MODE");
  let mockMode = parseBoolean(rawMock);
  if (rawMock !== undefined && mockMode === undefined) {
    problems.push('MOCK_MODE: ต้องเป็น "true" หรือ "false"');
  } else if (mockMode === undefined) {
    if (isProduction) {
      problems.push('MOCK_MODE: ต้องกำหนดเป็น "true" หรือ "false" อย่างชัดเจนใน production');
    } else {
      mockMode = true;
    }
  }

  const anthropicApiKey = readString(env, "ANTHROPIC_API_KEY");
  const anthropicModel = readString(env, "ANTHROPIC_MODEL");
  if (mockMode === false) {
    if (!anthropicApiKey) problems.push("ANTHROPIC_API_KEY: ต้องกำหนดเมื่อ MOCK_MODE=false");
    if (!anthropicModel) problems.push("ANTHROPIC_MODEL: ต้องกำหนดเมื่อ MOCK_MODE=false");
    else if (!/^[a-z0-9][a-z0-9.\-_@:]{2,99}$/i.test(anthropicModel)) {
      problems.push("ANTHROPIC_MODEL: รูปแบบชื่อ model ไม่ถูกต้อง");
    }
  }

  const contextTokenBudget = parseIntInRange(
    readString(env, "CONTEXT_TOKEN_BUDGET"),
    12000,
    1000,
    200000,
  );
  if (contextTokenBudget === undefined) {
    problems.push("CONTEXT_TOKEN_BUDGET: ต้องเป็นตัวเลข 1000-200000");
  }

  const trustProxyHops = parseIntInRange(
    readString(env, "TRUST_PROXY_HOPS"),
    isProduction ? 1 : 0,
    0,
    10,
  );
  if (trustProxyHops === undefined) problems.push("TRUST_PROXY_HOPS: ต้องเป็นตัวเลข 0-10");

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    nodeEnv,
    isProduction,
    host: readString(env, "HOST") ?? "0.0.0.0",
    port: port!,
    databaseUrl: databaseUrl!,
    sessionSecret: sessionSecret!,
    appOrigins,
    mockMode: mockMode!,
    anthropicApiKey,
    anthropicModel,
    contextTokenBudget: contextTokenBudget!,
    trustProxyHops: trustProxyHops!,
    clientDistDir: path.resolve(readString(env, "CLIENT_DIST_DIR") ?? "dist/client"),
  };
}
