import { randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { Channel } from "./context.js";

/** Test-only helpers: synthetic identities (never real people, R6) and dev-signed tokens. */
if (process.env.NODE_ENV === "production") throw new Error("@clniq/kit/testing must not be loaded in production");

export const TEST_ISSUER = "https://id.test.clniq.local";
export const TEST_AUDIENCE = "clniq-api";
/** Random per process: no signing secret lives in source or in the built package. */
export const testKey: Uint8Array = randomBytes(32);

export type TestPrincipal = {
  tid: string;
  cids?: string[];
  pids?: string[];
  sub?: string;
  roles?: string[];
  ent_v?: number;
  chn?: Channel;
};

export const tokenFor = (p: TestPrincipal): Promise<string> =>
  new SignJWT({ tid: p.tid, cids: p.cids ?? [], pids: p.pids ?? [], roles: p.roles ?? ["doctor"], ent_v: p.ent_v ?? 1, chn: p.chn ?? "UI" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub ?? `user-${randomUUID()}`)
    .setIssuer(TEST_ISSUER)
    .setAudience(TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(testKey);

export const testAuth = { issuer: TEST_ISSUER, audience: TEST_AUDIENCE, devKey: async () => testKey };

/** Two tenants, each with one clinic and two doctors' practices: the minimum to prove A≠B and X≠Y. */
export const isolationFixture = () => {
  const mk = () => ({ tid: randomUUID(), clinic: randomUUID(), doctorX: randomUUID(), doctorY: randomUUID() });
  return { A: mk(), B: mk() };
};

export const requireDatabaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set: run `pnpm db:up` (CI provides Postgres). RLS and run-alone tests never skip.");
  return url;
};

const TEST_DB_PREFIX = "t_";

/**
 * Creates an isolated, throwaway database for one test file and returns a cleanup that removes ONLY that database.
 * Cleanup refuses any name it did not create, so it can never touch a real database.
 */
export const freshDatabase = async (baseUrl: string, label: string): Promise<{ url: string; drop: () => Promise<void> }> => {
  const pg = (await import("pg")).default;
  const name = `${TEST_DB_PREFIX}${label.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${randomUUID().slice(0, 8)}`;
  const withAdmin = async (sql: string): Promise<void> => {
    const admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    try {
      await admin.query(sql);
    } finally {
      await admin.end();
    }
  };
  await withAdmin(`CREATE DATABASE ${name}`);
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      if (!/^t_[a-z0-9_]+_[0-9a-f]{8}$/.test(name)) throw new Error(`refusing to remove non-test database ${name}`);
      await withAdmin(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    }
  };
};
