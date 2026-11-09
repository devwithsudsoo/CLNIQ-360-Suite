import { randomUUID } from "node:crypto";
import { createDb, migrate, withTenant } from "@clniq/kit";
import { fileURLToPath } from "node:url";
import { SCHEMA } from "../src/server.js";

/** Synthetic seed only (R6): generated ids and labels, no real people. */
const db = createDb(process.env.DATABASE_URL ?? "postgres://clniq@localhost:54329/postgres");
await migrate(db, SCHEMA, fileURLToPath(new URL("../../migrations/", import.meta.url)));
const tenantId = randomUUID(), clinicId = randomUUID(), practiceId = randomUUID();
await withTenant(db, { tenantId, clinicIds: [clinicId], practiceIds: [practiceId], userId: "seed", roles: ["seed"], entV: 1, channel: "UI", correlationId: "seed" }, async (tx) => {
  for (let i = 1; i <= 5; i++) {
    await tx.query(`INSERT INTO ${SCHEMA}.records (id, tenant_id, clinic_id, practice_id, label) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), tenantId, clinicId, practiceId, `Synthetic record ${i}`]);
  }
});
console.warn(`seeded ${SCHEMA}: tenant ${tenantId}`);
await db.end();
