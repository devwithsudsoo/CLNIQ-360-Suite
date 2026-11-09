import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { contextFromClaims, runWithContext, type TenantContext } from "./context.js";
import { withTenant, type Db } from "./db.js";
import { logger } from "./log.js";

/** RFC 9457 problem (R7). */
export class Problem extends Error {
  constructor(readonly status: number, readonly title: string, readonly code: string, readonly detail?: string) {
    super(detail ?? title);
  }
}

const sendProblem = (reply: FastifyReply, req: FastifyRequest, p: Problem) =>
  reply
    .status(p.status)
    .type("application/problem+json")
    .send({ type: `https://errors.clniq.com/${p.code}`, title: p.title, status: p.status, detail: p.detail, code: p.code, instance: req.url, correlation_id: req.id });

/** Opaque keyset cursor (R7 cursor paging). */
export const encodeCursor = (v: Record<string, string | number>): string => Buffer.from(JSON.stringify(v)).toString("base64url");
export const decodeCursor = <T>(c: string | undefined): T | null => {
  if (!c) return null;
  try {
    return JSON.parse(Buffer.from(c, "base64url").toString("utf8")) as T;
  } catch {
    throw new Problem(400, "Invalid cursor", "invalid-cursor");
  }
};

declare module "fastify" {
  interface FastifyRequest {
    tenant?: TenantContext;
  }
}

export type AuthConfig = { issuer: string; audience: string; jwksUrl?: string; devKey?: JWTVerifyGetKey };

export type ModuleServerOptions = {
  key: string;
  schema: string;
  db: Db;
  auth: AuthConfig;
  ready?: () => Promise<Record<string, string>>;
};

/**
 * Fastify base every module and core service uses: correlation ids, JWT → tenant context (defence in depth behind the gateway),
 * problem+json errors, Idempotency-Key enforcement and replay on writes, /health/live and /health/ready.
 */
export const createModuleServer = ({ key, schema, db, auth, ready }: ModuleServerOptions): FastifyInstance => {
  const app = Fastify({ loggerInstance: logger.child({ module: key }) as FastifyBaseLogger, genReqId: (req) => String(req.headers["x-correlation-id"] ?? randomUUID()) });
  const keys = auth.devKey ?? (auth.jwksUrl ? createRemoteJWKSet(new URL(auth.jwksUrl)) : undefined);
  if (!keys) throw new Error("auth: jwksUrl or devKey required");

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof Problem) return sendProblem(reply, req, err);
    if ((err as { validation?: unknown }).validation) return sendProblem(reply, req, new Problem(400, "Validation failed", "validation", err.message));
    req.log.error({ err: { message: err.message, code: (err as { code?: string }).code } }, "unhandled");
    return sendProblem(reply, req, new Problem(500, "Internal error", "internal"));
  });
  app.setNotFoundHandler((req, reply) => sendProblem(reply, req, new Problem(404, "Not found", "not-found")));

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ok", checks: { db: "ok", ...(ready ? await ready() : {}) } };
    } catch {
      return reply.status(503).send({ status: "down", checks: { db: "down" } });
    }
  });

  app.addHook("onRequest", async (req) => {
    if (req.url.startsWith("/health/")) return;
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new Problem(401, "Unauthenticated", "unauthenticated");
    try {
      const { payload } = await jwtVerify(header.slice(7), keys, { issuer: auth.issuer, audience: auth.audience });
      req.tenant = contextFromClaims(payload, req.id);
    } catch {
      throw new Problem(401, "Unauthenticated", "unauthenticated");
    }
  });

  // Idempotency-Key on writes (R7): first call stores the response; a replay with the same body returns it; a different body is a 422.
  app.addHook("preHandler", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || !req.tenant) return;
    const idemKey = req.headers["idempotency-key"];
    if (typeof idemKey !== "string" || idemKey.length < 8 || idemKey.length > 128) throw new Problem(400, "Idempotency-Key header required", "idempotency-key-required");
    const hash = createHash("sha256").update(`${req.method} ${req.routeOptions.url} ${JSON.stringify(req.body ?? null)}`).digest("hex");
    const prior = await withTenant(db, req.tenant, async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO ${schema}.idempotency_keys (tenant_id, key, request_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [req.tenant!.tenantId, idemKey, hash]
      );
      if (inserted.rowCount) return null;
      const { rows } = await tx.query(`SELECT request_hash, status_code, response FROM ${schema}.idempotency_keys WHERE tenant_id = $1 AND key = $2`, [req.tenant!.tenantId, idemKey]);
      return rows[0] as { request_hash: string; status_code: number | null; response: unknown };
    });
    if (!prior) return;
    if (prior.request_hash !== hash) throw new Problem(422, "Idempotency-Key reused with a different request", "idempotency-key-mismatch");
    if (prior.status_code === null) throw new Problem(409, "Request with this Idempotency-Key is in progress", "idempotency-in-progress");
    return reply.status(prior.status_code).header("idempotent-replay", "true").send(prior.response);
  });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-correlation-id", req.id);
    const idemKey = req.headers["idempotency-key"];
    if (req.method === "GET" || !req.tenant || typeof idemKey !== "string" || reply.getHeader("idempotent-replay")) return payload;
    if (reply.statusCode >= 500) {
      await withTenant(db, req.tenant, (tx) => tx.query(`DELETE FROM ${schema}.idempotency_keys WHERE tenant_id = $1 AND key = $2`, [req.tenant!.tenantId, idemKey]));
      return payload;
    }
    let body: unknown = null;
    try {
      body = typeof payload === "string" && payload.length ? JSON.parse(payload) : null;
    } catch {
      body = null;
    }
    await withTenant(db, req.tenant, (tx) =>
      tx.query(`UPDATE ${schema}.idempotency_keys SET status_code = $3, response = $4 WHERE tenant_id = $1 AND key = $2`, [req.tenant!.tenantId, idemKey, reply.statusCode, JSON.stringify(body)])
    );
    return payload;
  });

  return app;
};

/** Run a route body with tenant context bound for the async call chain. */
export const scoped = <T>(req: FastifyRequest, fn: (ctx: TenantContext) => Promise<T>): Promise<T> => {
  if (!req.tenant) throw new Problem(401, "Unauthenticated", "unauthenticated");
  const ctx = req.tenant;
  return runWithContext(ctx, () => fn(ctx));
};
