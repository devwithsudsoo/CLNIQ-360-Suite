import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/** Secrets come from Key Vault on Azure (R10); native targets plug DPAPI/Keychain providers in later milestones. */
export interface SecretProvider {
  get(name: string): Promise<string>;
}

/** Azure Key Vault via managed identity (no stored credentials). Values are cached for ttlMs. */
export class KeyVaultSecretProvider implements SecretProvider {
  private readonly client: SecretClient;
  private readonly cache = new Map<string, { value: string; until: number }>();
  constructor(vaultUrl: string, private readonly ttlMs = 5 * 60_000) {
    this.client = new SecretClient(vaultUrl, new DefaultAzureCredential());
  }
  async get(name: string): Promise<string> {
    const hit = this.cache.get(name);
    if (hit && hit.until > Date.now()) return hit.value;
    const secret = await this.client.getSecret(name);
    if (!secret.value) throw new Error(`Secret ${name} is empty`);
    this.cache.set(name, { value: secret.value, until: Date.now() + this.ttlMs });
    return secret.value;
  }
}

/** Local development and CI only: reads CLNIQ_SECRET_<NAME>. Refuses to run when NODE_ENV=production. */
export class EnvSecretProvider implements SecretProvider {
  constructor() {
    if (process.env.NODE_ENV === "production") throw new Error("EnvSecretProvider is not allowed in production");
  }
  async get(name: string): Promise<string> {
    const value = process.env[`CLNIQ_SECRET_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`];
    if (!value) throw new Error(`Secret ${name} not set`);
    return value;
  }
}

/** Per-tenant secret naming so one tenant's integration credentials never resolve for another. */
export const tenantSecretName = (tenantId: string, integration: string, key: string): string =>
  `t-${tenantId}-${integration}-${key}`.replace(/[^A-Za-z0-9-]/g, "-");

export const secretProviderFromEnv = (): SecretProvider =>
  process.env.KEY_VAULT_URL ? new KeyVaultSecretProvider(process.env.KEY_VAULT_URL) : new EnvSecretProvider();
