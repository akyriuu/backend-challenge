import { defineEntity, p, type InferEntity } from '@mikro-orm/core';
import type { FailureCode } from '@/domain/failure-code';
import type {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';

export const WagerTransactionSchema = defineEntity({
  name: 'WagerTransaction',
  tableName: 'wager_transactions',
  properties: {
    id: p.uuid().primary(),
    providerId: p.string(),
    externalTransactionId: p.string(),
    idempotencyKey: p.string(),
    payloadHash: p.string(),
    walletId: p.uuid(),
    playerId: p.uuid(),
    roundId: p.string(),
    gameId: p.string(),
    kind: p.string().$type<WagerTransactionKind>(),
    amount: p.decimal(),
    currency: p.string(),
    referenceExternalTransactionId: p.string().nullable(),
    referenceTransactionId: p.uuid().nullable(),
    status: p.string().$type<WagerTransactionStatus>(),
    failureCode: p.string().$type<FailureCode>().nullable(),
    referenceAttempts: p.integer(),
    createdAt: p.datetime(),
    processedAt: p.datetime().nullable(),
  },
});

export type WagerTransactionRecord = InferEntity<typeof WagerTransactionSchema>;
