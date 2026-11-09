import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TenantContext } from "./context.js";
import { baseSchemaSql, rlsPolicySql, type RlsScope } from "./sql.js";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export const createDb = (connectionString: string, max = 10): Db => new pg.Pool({ connectionString, max });

/**
 * R1: every request transaction runs as clniq_app with tenant scope set LOCAL to the transaction,
 * so a pooled connection never carries one tenant's scope into another request.
 */
export const withTenant = async <T>(db: Db, ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> => {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SET LOCAL ROLE clniq_app");
    await tx.query(
      "SELECT set_config('app.tenant', $1, true), set_config('app.clinic_ids', $2, true), set_config('app.practice_ids', $3, true)",
      [ctx.tenantId, ctx.clinicIds.join(","), ctx.practiceIds.join(",")]
    );
    const result = await fn(tx);
    await tx.query("COMMIT");
    return result;
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
};

const kitSqlDir = fileURLToPath(new URL("../sql/", import.meta.url));

/** Applies cluster bootstrap, the module base schema, then migrations/NNN_*.sql in order (each once, each in a txn). */
export const migrate = async (db: Db, schema: string, migrationsDir: string): Promise<string[]> => {
  const applied: string[] = [];
  const admin = await db.connect();
  try {
    await admin.query("SELECT pg_advisory_lock(hashtext('clniq:migrate'))");
    await admin.query(readFileSync(join(kitSqlDir, "000_cluster.sql"), "utf8"));
    await admin.query(baseSchemaSql(schema));
    const files = existsSync(migrationsDir) ? readdirSync(migrationsDir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort() : [];
    for (const file of files) {
      const { rowCount } = await admin.query(`SELECT 1 FROM ${schema}.schema_migrations WHERE version = $1`, [file]);
      if (rowCount) continue;
      await admin.query("BEGIN");
      try {
        await admin.query(expandDirectives(readFileSync(join(migrationsDir, file), "utf8"), schema));
        await admin.query(`INSERT INTO ${schema}.schema_migrations(version) VALUES ($1)`, [file]);
        await admin.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await admin.query("ROLLBACK");
        throw new Error(`Migration ${schema}/${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await admin.query("SELECT pg_advisory_unlock(hashtext('clniq:migrate'))").catch(() => undefined);
    admin.release();
  }
  return applied;
};

/** `-- @rls <schema>.<table> <tenant|clinic|practice>` → policies from the single kit template. A module may only target its own schema. */
export const expandDirectives = (sql: string, ownSchema: string): string =>
  sql.replace(/^-- @rls ([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*) (tenant|clinic|practice)\s*$/gm, (_m, s: string, t: string, scope: RlsScope) => {
    if (s !== ownSchema) throw new Error(`@rls targets schema ${s}; module owns ${ownSchema}`);
    return rlsPolicySql(s, t, scope);
  });
