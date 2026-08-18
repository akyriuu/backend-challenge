import { defineEntity, p, type InferEntity } from '@mikro-orm/core';

export const InboxMessageSchema = defineEntity({
  name: 'InboxMessage',
  tableName: 'inbox_messages',
  properties: {
    consumerName: p.string().primary(),
    messageId: p.string().primary(),
    payloadHash: p.string(),
    receivedAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export type InboxMessageRecord = InferEntity<typeof InboxMessageSchema>;
