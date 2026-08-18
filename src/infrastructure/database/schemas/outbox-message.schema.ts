import { defineEntity, p, type InferEntity } from '@mikro-orm/core';

export const OutboxMessageSchema = defineEntity({
  name: 'OutboxMessage',
  tableName: 'outbox_messages',
  properties: {
    id: p.uuid().primary(),
    aggregateId: p.uuid(),
    eventType: p.string(),
    payload: p.json<Record<string, unknown>>(),
    occurredAt: p.datetime(),
    attempts: p.integer(),
    nextAttemptAt: p.datetime().nullable(),
    publishedAt: p.datetime().nullable(),
  },
});

export type OutboxMessageRecord = InferEntity<typeof OutboxMessageSchema>;
