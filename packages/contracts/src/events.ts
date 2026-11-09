import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const require = createRequire(import.meta.url);
const envelopeSchema = require("../events/envelope.schema.json");

export type Actor = { kind: "user" | "system" | "integration"; id: string };

/** R8 event envelope. */
export type EventEnvelope<T extends object = Record<string, unknown>> = {
  id: string;
  type: string;
  v: number;
  tenant_id: string;
  clinic_id: string | null;
  practice_id: string | null;
  actor: Actor;
  correlation_id: string;
  ts: string;
  data: T;
};

export type EventScope = Pick<EventEnvelope, "tenant_id" | "clinic_id" | "practice_id" | "actor" | "correlation_id">;

const ajv = new Ajv2020.default({ allErrors: true, strict: false });
addFormats.default(ajv);
const validateEnvelope = ajv.compile(envelopeSchema);

export const makeEvent = <T extends object>(type: string, v: number, scope: EventScope, data: T): EventEnvelope<T> => ({
  id: randomUUID(),
  type,
  v,
  ...scope,
  ts: new Date().toISOString(),
  data
});

export const assertEnvelope = (value: unknown): EventEnvelope => {
  if (validateEnvelope(value)) return value as EventEnvelope;
  throw new Error(`Invalid event envelope: ${ajv.errorsText(validateEnvelope.errors)}`);
};
