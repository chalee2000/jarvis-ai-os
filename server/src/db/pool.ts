import pg from "pg";

export type Db = pg.Pool;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Guard against runaway queries; chat generation never holds a DB connection.
    statement_timeout: 10_000,
    application_name: "jarvis-v1",
  });
}
