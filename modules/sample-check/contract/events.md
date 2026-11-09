# Sample Check events

All events use the R8 envelope (`packages/contracts/events/envelope.schema.json`), are written to `sample_check.outbox` in the same transaction as the change, and are delivered at least once. Consumers dedupe on `id`.

| Type | v | When | data |
| --- | --- | --- | --- |
| `SampleCheckRecordCreated` | 1 | A record is created | `{ record_id }` — ids only, never PHI values |
