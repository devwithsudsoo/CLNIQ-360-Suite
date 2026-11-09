import replyFrom from "@fastify/reply-from";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { contextFromClaims, logger, tagTenant, type TenantContext } from "@clniq/kit";
import { checkEntitlement, type EntitlementCache, type QuotaCounter } from "./entitlements.js";
import { hasPermission, matchRule, type PermissionResolver, type RouteRule } from "./rbac.js";

export type UpstreamModule = { key: string; upstream: string; rules: RouteRule[] };

export type GatewayOptions = {
  modules: UpstreamModule[];
  entitlements: EntitlementCache;
  permissions: PermissionResolver;
  quota: QuotaCounter;
  auth: { issuer: string; audience: string; jwksUrl?: string; devKey?: JWTVerifyGetKey };
  /** Modules always on for every tenant (core). */
  alwaysOn?: string[];
};

const problem = (status: number, code: string, title: string, detail: string | undefined, instance: string, correlationId: string) => ({
  type: `https://errors.clniq.com/${code}`, title, status, detail, code, instance, correlation_id: correlationId
});

/** R4: entitlement first, then RBAC, then proxy. The server is the authority; the UI only hides. */
export const createGateway = (opts: GatewayOptions): FastifyInstance => {
  const app = Fastify({ loggerInstance: logger.child({ svc: "gateway" }) as FastifyBaseLogger, genReqId: (req) => String(req.headers["x-correlation-id"] ?? crypto.randomUUID()) });
  const keys = opts.auth.devKey ?? (opts.auth.jwksUrl ? createRemoteJWKSet(new URL(opts.auth.jwksUrl)) : undefined);
  if (!keys) throw new Error("gateway auth: jwksUrl or devKey required");
  const byKey = new Map(opts.modules.map((m) => [m.key, m]));
  const alwaysOn = new Set(opts.alwaysOn ?? ["core"]);

  app.register(replyFrom, { http: { requestOptions: { timeout: 30_000 } } });
  // Any unexpected failure (upstream unreachable, resolver outage) leaves as RFC 9457, never a raw error.
  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err: { message: err.message, code: err.code } }, "gateway error");
    const status = err.statusCode !== undefined && err.statusCode < 500 ? err.statusCode : 502;
    return reply.status(status).type("application/problem+json").send(problem(status, status === 502 ? "bad-gateway" : "request-error", status === 502 ? "Upstream unavailable" : "Bad request", undefined, req.url.split("?")[0] ?? "", req.id));
  });
  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => ({ status: "ok" }));

  app.all("/api/v1/:module/*", async (req, reply) => {
    const deny = (status: number, code: string, title: string, detail?: string) =>
      reply.status(status).type("application/problem+json").send(problem(status, code, title, detail, req.url.split("?")[0] ?? "", req.id));

    const moduleKey = (req.params as { module: string }).module;
    const mod = byKey.get(moduleKey);
    if (!mod) return deny(404, "not-found", "Not found");
    const path = req.url.split("?")[0] ?? "";
    const rule = matchRule(mod.rules, req.method, path);
    if (!rule) return deny(404, "not-found", "Not found");

    let ctx: TenantContext;
    try {
      const header = req.headers.authorization ?? "";
      if (!header.startsWith("Bearer ")) throw new Error("missing");
      const { payload } = await jwtVerify(header.slice(7), keys, { issuer: opts.auth.issuer, audience: opts.auth.audience });
      ctx = contextFromClaims(payload, req.id);
    } catch {
      return deny(401, "unauthenticated", "Unauthenticated");
    }
    tagTenant(ctx.tenantId, moduleKey);

    // Fail closed: if entitlements or permissions cannot be resolved, deny with 503 rather than guess.
    if (!alwaysOn.has(moduleKey)) {
      let decision;
      try {
        const ents = await opts.entitlements.get(ctx.tenantId, ctx.entV);
        decision = await checkEntitlement(ents, moduleKey, ctx.channel, rule.action, opts.quota);
      } catch (err) {
        req.log.error({ err: { message: (err as Error).message } }, "entitlement lookup failed");
        return deny(503, "entitlements-unavailable", "Service unavailable", "Entitlements could not be verified");
      }
      if (!decision.allow) return deny(decision.status, decision.code, decision.status === 429 ? "Quota exceeded" : "Forbidden", decision.detail);
    }

    let granted: Set<string>;
    try {
      granted = await opts.permissions.permissionsFor(ctx.tenantId, ctx.roles);
    } catch (err) {
      req.log.error({ err: { message: (err as Error).message } }, "permission lookup failed");
      return deny(503, "permissions-unavailable", "Service unavailable", "Permissions could not be verified");
    }
    if (!hasPermission(granted, rule.permission)) return deny(403, "permission-denied", "Forbidden", `Requires ${rule.permission}`);

    return reply.from(`${mod.upstream}${req.url}`, {
      rewriteRequestHeaders: (_r, headers) => ({ ...headers, "x-correlation-id": req.id })
    });
  });

  return app;
};
