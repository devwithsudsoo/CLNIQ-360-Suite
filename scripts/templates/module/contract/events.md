# __NAME__ events

All events use the R8 envelope (`packages/contracts/events/envelope.schema.json`), are written to `__SCHEMA__.outbox` in the same transaction as the change, and are delivered at least once. Consumers dedupe on `id`.

| Type | v | When | data |
| --- | --- | --- | --- |
| `__PASCAL__RecordCreated` | 1 | A record is created | `{ record_id }` — ids only, never PHI values |
