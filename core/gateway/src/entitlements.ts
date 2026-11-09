import type { Channel } from "@clniq/kit";

export type EntitlementStatus = "enabled" | "trial" | "suspended" | "disabled";

/** Mirrors the C1 entitlement record. */
export type Entitlement = {
  module_key: string;
  status: EntitlementStatus;
  channels: Channel[];
  api_quota: number | null; // calls per day on the API channel; null = unlimited
  valid_from: string | null;
  valid_to: string | null;
};

export type TenantEntitlements = { tenant_id: string; ent_v: number; modules: Entitlement[] };

/** Port: where entitlements come from. Core API on every target; a static file when a module runs alone in dev. */
export interface EntitlementSource {
  fetch(tenantId: string): Promise<TenantEntitlements>;
}

export class CoreApiEntitlements implements EntitlementSource {
  constructor(private readonly coreUrl: string, private readonly serviceToken: () => Promise<string>) {}
  async fetch(tenantId: string): Promise<TenantEntitlements> {
    let res: Response;
    try {
      res = await fetch(new URL(`/api/v1/core/entitlements/${encodeURIComponent(tenantId)}`, this.coreUrl), {
        headers: { authorization: `Bearer ${await this.serviceToken()}` },
        signal: AbortSignal.timeout(2000)
      });
    } catch (err) {
      throw new Error(`core entitlements unreachable: ${(err as Error).message}`, { cause: err });
    }
    if (!res.ok) throw new Error(`core entitlements ${res.status}`);
    try {
      return (await res.json()) as TenantEntitlements;
    } catch (err) {
      throw new Error("core entitlements returned invalid JSON", { cause: err });
    }
  }
}

export class StaticEntitlements implements EntitlementSource {
  constructor(private readonly byTenant: Record<string, TenantEntitlements>) {}
  async fetch(tenantId: string): Promise<TenantEntitlements> {
    return this.byTenant[tenantId] ?? { tenant_id: tenantId, ent_v: 0, modules: [] };
  }
}

/**
 * Cache keyed by tenant + ent_v. A token carrying a newer ent_v forces a refetch at once;
 * otherwise entries live ttlMs (≤5s), so a toggle in C2 takes effect within 5s even for older tokens.
 */
export class EntitlementCache {
  private readonly entries = new Map<string, { value: TenantEntitlements; until: number }>();
  constructor(private readonly source: EntitlementSource, private readonly ttlMs = 5000) {}

  async get(tenantId: string, tokenEntV: number): Promise<TenantEntitlements> {
    const hit = this.entries.get(tenantId);
    if (hit && hit.until > Date.now() && hit.value.ent_v >= tokenEntV) return hit.value;
    const value = await this.source.fetch(tenantId);
    this.entries.set(tenantId, { value, until: Date.now() + this.ttlMs });
    return value;
  }

  invalidate(tenantId: string): void {
    this.entries.delete(tenantId);
  }
}

export type Decision = { allow: true } | { allow: false; status: 403 | 429; code: string; detail: string };

/** Quota counter port (per tenant, module, UTC day). In-memory for native/single node; Redis adapter arrives with C1's cache. */
export interface QuotaCounter {
  increment(key: string): Promise<number>;
}
export class MemoryQuotaCounter implements QuotaCounter {
  private readonly counts = new Map<string, number>();
  async increment(key: string): Promise<number> {
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
}

const READ_ACTIONS = new Set(["read", "export"]);

/** R4 step 1: is this tenant entitled to this module on this channel, within quota? */
export const checkEntitlement = async (
  ents: TenantEntitlements,
  moduleKey: string,
  channel: Channel,
  action: string,
  quota: QuotaCounter,
  now = new Date()
): Promise<Decision> => {
  const e = ents.modules.find((m) => m.module_key === moduleKey);
  if (!e) return { allow: false, status: 403, code: "module-not-entitled", detail: `Tenant is not entitled to ${moduleKey}` };
  const inWindow = (!e.valid_from || new Date(e.valid_from) <= now) && (!e.valid_to || now < new Date(e.valid_to));
  const active = (e.status === "enabled" || e.status === "trial") && inWindow;
  // C2: disabling stops new writes but keeps data readable and exportable.
  if (!active && !READ_ACTIONS.has(action)) return { allow: false, status: 403, code: "module-disabled", detail: `${moduleKey} is ${inWindow ? e.status : "outside its validity window"}; data is read-only` };
  if (!e.channels.includes(channel)) return { allow: false, status: 403, code: "channel-not-entitled", detail: `${moduleKey} is not entitled on channel ${channel}` };
  if (channel === "API" && e.api_quota !== null) {
    const used = await quota.increment(`${ents.tenant_id}:${moduleKey}:${now.toISOString().slice(0, 10)}`);
    if (used > e.api_quota) return { allow: false, status: 429, code: "api-quota-exceeded", detail: `Daily API quota for ${moduleKey} exhausted` };
  }
  return { allow: true };
};
