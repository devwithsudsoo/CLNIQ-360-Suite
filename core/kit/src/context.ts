import { AsyncLocalStorage } from "node:async_hooks";

export type Channel = "UI" | "API";

/**
 * Request scope derived ONLY from the verified token (blueprint §3: never from request parameters).
 * Claims per C1: tid, cids, pids, roles, ent_v.
 */
export type TenantContext = {
  tenantId: string;
  clinicIds: string[];
  practiceIds: string[];
  userId: string;
  roles: string[];
  entV: number;
  channel: Channel;
  correlationId: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

export const runWithContext = <T>(ctx: TenantContext, fn: () => T): T => storage.run(ctx, fn);

export const currentContext = (): TenantContext => {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("No tenant context: request did not pass tenant middleware");
  return ctx;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidList = (v: unknown, claim: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && UUID.test(x))) throw new Error(`Invalid claim ${claim}`);
  return v as string[];
};

/** Parse-don't-validate: turn verified JWT claims into a TenantContext or throw. */
export const contextFromClaims = (claims: Record<string, unknown>, correlationId: string): TenantContext => {
  const { tid, sub, roles, ent_v, chn } = claims;
  if (typeof tid !== "string" || !UUID.test(tid)) throw new Error("Invalid claim tid");
  if (typeof sub !== "string" || sub.length === 0) throw new Error("Invalid claim sub");
  if (!Array.isArray(roles) || !roles.every((r) => typeof r === "string")) throw new Error("Invalid claim roles");
  if (typeof ent_v !== "number" || !Number.isInteger(ent_v)) throw new Error("Invalid claim ent_v");
  if (chn !== "UI" && chn !== "API") throw new Error("Invalid claim chn");
  return {
    tenantId: tid,
    clinicIds: uuidList(claims.cids, "cids"),
    practiceIds: uuidList(claims.pids, "pids"),
    userId: sub,
    roles: roles as string[],
    entV: ent_v,
    channel: chn,
    correlationId
  };
};
