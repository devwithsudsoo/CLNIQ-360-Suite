import { readFileSync } from "node:fs";
import { secretProviderFromEnv, startTelemetry } from "@clniq/kit";
import { CoreApiEntitlements, EntitlementCache, MemoryQuotaCounter, StaticEntitlements } from "./entitlements.js";
import { createGateway } from "./gateway.js";
import { rulesFromOpenApi, StaticPermissions } from "./rbac.js";

/**
 * Config (env): GATEWAY_MODULES = JSON [{ key, upstream, spec }], OIDC_ISSUER, OIDC_AUDIENCE, OIDC_JWKS_URL,
 * CORE_URL (entitlements) or ENTITLEMENTS_FILE (run-alone dev), ROLE_PERMISSIONS_FILE (until C1 RBAC service).
 */
startTelemetry("clniq-gateway");
const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const modules = (JSON.parse(env("GATEWAY_MODULES")) as Array<{ key: string; upstream: string; spec: string }>).map((m) => ({
  key: m.key,
  upstream: m.upstream,
  rules: rulesFromOpenApi(m.key, m.spec)
}));
const source = process.env.ENTITLEMENTS_FILE
  ? new StaticEntitlements(JSON.parse(readFileSync(process.env.ENTITLEMENTS_FILE, "utf8")))
  : new CoreApiEntitlements(env("CORE_URL"), () => secretProviderFromEnv().get("core-service-token"));
const app = createGateway({
  modules,
  entitlements: new EntitlementCache(source),
  permissions: new StaticPermissions(JSON.parse(readFileSync(env("ROLE_PERMISSIONS_FILE"), "utf8"))),
  quota: new MemoryQuotaCounter(),
  auth: { issuer: env("OIDC_ISSUER"), audience: env("OIDC_AUDIENCE"), jwksUrl: env("OIDC_JWKS_URL") }
});
try {
  await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
} catch (err) {
  app.log.fatal({ err: (err as Error).message }, "gateway failed to start");
  process.exit(1);
}
process.on("SIGTERM", () => void app.close().then(() => process.exit(0)));
