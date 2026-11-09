import { readFileSync } from "node:fs";
import { parse } from "yaml";

/** Port: role → permission strings ("<m>:<action>[:scope]", "<m>:*"). Core RBAC service (C1) is the production adapter. */
export interface PermissionResolver {
  permissionsFor(tenantId: string, roles: string[]): Promise<Set<string>>;
}

export class StaticPermissions implements PermissionResolver {
  constructor(private readonly roleMap: Record<string, string[]>) {}
  async permissionsFor(_tenantId: string, roles: string[]): Promise<Set<string>> {
    return new Set(roles.flatMap((r) => this.roleMap[r] ?? []));
  }
}

export const hasPermission = (granted: Set<string>, required: string): boolean => {
  if (granted.has(required)) return true;
  const [m] = required.split(":");
  return granted.has(`${m}:*`);
};

export type RouteRule = { method: string; pattern: RegExp; permission: string; action: string };

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/**
 * Compiles a module's OpenAPI into gateway rules. Every operation must declare x-permission "<m>:<action>";
 * an operation without one is not routable (fail closed). Contract tests enforce presence.
 */
export const rulesFromOpenApi = (moduleKey: string, specPath: string): RouteRule[] => {
  const spec = parse(readFileSync(specPath, "utf8")) as { paths?: Record<string, Record<string, { "x-permission"?: string }>> };
  const rules: RouteRule[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const permission = op["x-permission"];
      if (!permission?.startsWith(`${moduleKey}:`)) throw new Error(`${moduleKey} ${m.toUpperCase()} ${path}: x-permission "${moduleKey}:<action>" required`);
      const pattern = new RegExp(`^${path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}]+\}/g, "[^/]+")}/?$`);
      rules.push({ method: m.toUpperCase(), pattern, permission, action: permission.split(":")[1] ?? "" });
    }
  }
  return rules;
};

export const matchRule = (rules: RouteRule[], method: string, path: string): RouteRule | undefined =>
  rules.find((r) => r.method === method && r.pattern.test(path));
