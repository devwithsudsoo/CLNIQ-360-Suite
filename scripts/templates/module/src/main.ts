import { fileURLToPath } from "node:url";
import { createDb, InProcessBus, logger, migrate, relayOnce, startTelemetry } from "@clniq/kit";
import { buildServer, MODULE_KEY, SCHEMA } from "./server.js";

startTelemetry(`clniq-${MODULE_KEY}`);
const need = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is required`);
  return v;
};
const db = createDb(need("DATABASE_URL"));
await migrate(db, SCHEMA, fileURLToPath(new URL("../../migrations/", import.meta.url)));
const app = buildServer(db, { issuer: need("OIDC_ISSUER"), audience: need("OIDC_AUDIENCE"), jwksUrl: need("OIDC_JWKS_URL") });
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });

// Outbox relay. Service Bus publisher is wired by the Azure packaging milestone; native installs use the in-process bus.
const bus = new InProcessBus();
setInterval(() => relayOnce(db, bus, { schema: SCHEMA }).catch((err: Error) => logger.error({ err: err.message }, "relay")), 1000).unref();
