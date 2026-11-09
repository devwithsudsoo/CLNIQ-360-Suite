import { createHmac, timingSafeEqual } from "node:crypto";
import { assertEnvelope, type EventEnvelope } from "@clniq/contracts/events";
import type { Db, Tx } from "./db.js";

/** Write the event in the SAME transaction as the state change (transactional outbox, R2/R8). */
export const enqueue = async (tx: Tx, schema: string, event: EventEnvelope): Promise<void> => {
  assertEnvelope(event);
  await tx.query(
    `INSERT INTO ${schema}.outbox (id, tenant_id, clinic_id, practice_id, type, envelope) VALUES ($1,$2,$3,$4,$5,$6)`,
    [event.id, event.tenant_id, event.clinic_id, event.practice_id, event.type, event]
  );
};

/** Where relayed events go: Service Bus on Azure, in-process on native installs (packaging Part B). */
export interface Publisher {
  publish(event: EventEnvelope): Promise<void>;
}

export class InProcessBus implements Publisher {
  private readonly handlers = new Map<string, Array<(e: EventEnvelope) => Promise<void>>>();
  on(type: string, handler: (e: EventEnvelope) => Promise<void>): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  async publish(event: EventEnvelope): Promise<void> {
    for (const h of this.handlers.get(event.type) ?? []) await h(event);
  }
}

export type RelayOptions = { schema: string; batch?: number; maxAttempts?: number };

/**
 * At-least-once relay. Rows are claimed with SKIP LOCKED so several relays can run.
 * Failures back off exponentially; after maxAttempts the row is marked dead (DLQ) for replay.
 */
export const relayOnce = async (db: Db, publisher: Publisher, { schema, batch = 100, maxAttempts = 8 }: RelayOptions): Promise<number> => {
  const tx = await db.connect();
  let published = 0;
  try {
    await tx.query("BEGIN");
    await tx.query("SET LOCAL ROLE clniq_relay");
    const { rows } = await tx.query<{ id: string; envelope: EventEnvelope; attempts: number }>(
      `SELECT id, envelope, attempts FROM ${schema}.outbox
        WHERE published_at IS NULL AND NOT dead AND next_attempt_at <= now()
        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batch]
    );
    for (const row of rows) {
      try {
        await publisher.publish(row.envelope);
        await tx.query(`UPDATE ${schema}.outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1`, [row.id]);
        published++;
      } catch (err) {
        const attempts = row.attempts + 1;
        await tx.query(
          `UPDATE ${schema}.outbox SET attempts = $2::int, last_error = $3, dead = $4,
             next_attempt_at = now() + make_interval(secs => least(3600, power(2, $2::int)::int)) WHERE id = $1`,
          [row.id, attempts, String((err as Error).message).slice(0, 500), attempts >= maxAttempts]
        );
      }
    }
    await tx.query("COMMIT");
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
  return published;
};

/** Re-queue dead-lettered events (Platform Admin DLQ replay). */
export const replayDead = async (db: Db, schema: string, ids: string[]): Promise<number> => {
  const tx = await db.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SET LOCAL ROLE clniq_relay");
    const { rowCount } = await tx.query(
      `UPDATE ${schema}.outbox SET dead = false, attempts = 0, next_attempt_at = now() WHERE dead AND id = ANY($1::uuid[])`,
      [ids]
    );
    await tx.query("COMMIT");
    return rowCount ?? 0;
  } catch (err) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    tx.release();
  }
};

/** Idempotent consumer: runs the handler at most once per (consumer, event id) inside the caller's tenant txn. */
export const consumeOnce = async (tx: Tx, schema: string, consumer: string, event: EventEnvelope, handler: () => Promise<void>): Promise<boolean> => {
  const { rowCount } = await tx.query(
    `INSERT INTO ${schema}.inbox (consumer, event_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [consumer, event.id, event.tenant_id]
  );
  if (!rowCount) return false;
  await handler();
  return true;
};

/** Signed webhooks out / verified signatures in (R8, R10). Header: t=<unix>,v1=<hex hmac-sha256 of "t.body">. */
export const signPayload = (secret: string, body: string, now = Math.floor(Date.now() / 1000)): string =>
  `t=${now},v1=${createHmac("sha256", secret).update(`${now}.${body}`).digest("hex")}`;

export const verifySignature = (secret: string, body: string, header: string, toleranceSec = 300, now = Math.floor(Date.now() / 1000)): boolean => {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(now - t) > toleranceSec || !parts.v1) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
};
