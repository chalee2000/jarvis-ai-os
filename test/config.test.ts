import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../server/src/config.js";

const SECRET = "a7f3c9e1b5d2f8a4c6e0b9d3f7a1c5e8";
const PROD_BASE = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.example.invalid:5432/jarvis",
  SESSION_SECRET: SECRET,
  APP_ORIGIN: "https://jarvis-v1-web.onrender.com",
  MOCK_MODE: "true",
};

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
  return [];
}

describe("production configuration", () => {
  it("accepts a complete configuration", () => {
    const config = loadConfig(PROD_BASE);
    expect(config.isProduction).toBe(true);
    expect(config.mockMode).toBe(true);
    expect(config.appOrigins).toEqual(["https://jarvis-v1-web.onrender.com"]);
    expect(config.trustProxyHops).toBe(1);
    expect(config.host).toBe("0.0.0.0");
  });

  it.each(["DATABASE_URL", "SESSION_SECRET", "APP_ORIGIN", "MOCK_MODE"])("refuses to start without %s", (key) => {
    const env: Record<string, string> = { ...PROD_BASE };
    delete env[key];
    expect(problems(env).some((p) => p.startsWith(key))).toBe(true);
  });

  it("requires the API key and model when MOCK_MODE=false", () => {
    const found = problems({ ...PROD_BASE, MOCK_MODE: "false" });
    expect(found.some((p) => p.startsWith("ANTHROPIC_API_KEY"))).toBe(true);
    expect(found.some((p) => p.startsWith("ANTHROPIC_MODEL"))).toBe(true);
    expect(
      problems({ ...PROD_BASE, MOCK_MODE: "false", ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_MODEL: "claude-opus-5-5" }),
    ).toEqual([]);
  });

  it("rejects weak secrets, http origins and invalid flags", () => {
    expect(problems({ ...PROD_BASE, SESSION_SECRET: "short" })[0]).toMatch(/^SESSION_SECRET/);
    expect(problems({ ...PROD_BASE, SESSION_SECRET: "change-me-change-me-change-me-change-me" })[0]).toMatch(
      /^SESSION_SECRET/,
    );
    expect(problems({ ...PROD_BASE, APP_ORIGIN: "http://insecure.example" })[0]).toMatch(/^APP_ORIGIN/);
    expect(problems({ ...PROD_BASE, MOCK_MODE: "yes" })[0]).toMatch(/^MOCK_MODE/);
  });

  it("falls back to RENDER_EXTERNAL_URL for the origin", () => {
    const env: Record<string, string> = { ...PROD_BASE, RENDER_EXTERNAL_URL: "https://jarvis-v1-web-abcd.onrender.com" };
    delete env.APP_ORIGIN;
    expect(loadConfig(env).appOrigins).toEqual(["https://jarvis-v1-web-abcd.onrender.com"]);
  });

  it("never includes secret values in error messages", () => {
    const env = { ...PROD_BASE, MOCK_MODE: "false", SESSION_SECRET: "tiny-secret-value" };
    let message = "";
    try {
      loadConfig(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toContain("tiny-secret-value");
    expect(message).not.toContain("user:pass");
  });

  it("the server process exits with code 1 when production config is incomplete", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "server/src/index.ts"], {
      env: { PATH: process.env.PATH, NODE_ENV: "production", DATABASE_URL: PROD_BASE.DATABASE_URL },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SESSION_SECRET");
    expect(result.stderr).toContain("APP_ORIGIN");
    expect(result.stderr).toContain("MOCK_MODE");
    expect(result.stderr).not.toContain("user:pass");
  });
});
