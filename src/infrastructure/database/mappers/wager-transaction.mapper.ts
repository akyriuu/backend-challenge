import { Money } from '@/domain/money';
import { WagerTransaction } from '@/domain/wager-transaction';
import type { WagerTransactionRecord } from '../schemas/wager-transaction.schema';

export const toWagerTransactionRecordData = (
  transaction: WagerTransaction,
): WagerTransactionRecord => ({
  id: transaction.id,
  providerId: transaction.providerId,
  externalTransactionId: transaction.externalTransactionId,
  idempotencyKey: transaction.idempotencyKey,
  payloadHash: transaction.payloadHash,
  walletId: transaction.walletId,
  playerId: transaction.playerId,
  roundId: transaction.roundId,
  gameId: transaction.gameId,
  kind: transaction.kind,
  amount: transaction.money.toString(),
  currency: transaction.money.currency,
  referenceExternalTransactionId:
    transaction.referenceExternalTransactionId ?? null,
  referenceTransactionId: transaction.referenceTransactionId ?? null,
  status: transaction.status,
  failureCode: transaction.failureCode ?? null,
  createdAt: transaction.createdAt,
  processedAt: transaction.processedAt ?? null,
});

export const toWagerTransactionDomain = (
  record: WagerTransactionRecord,
): WagerTransaction =>
  WagerTransaction.rehydrate({
    id: record.id,
    providerId: record.providerId,
    externalTransactionId: record.externalTransactionId,
    idempotencyKey: record.idempotencyKey,
    payloadHash: record.payloadHash,
    walletId: record.walletId,
    playerId: record.playerId,
    roundId: record.roundId,
    gameId: record.gameId,
    kind: record.kind,
    money: Money.from({ amount: record.amount, currency: record.currency }),
    referenceExternalTransactionId:
      record.referenceExternalTransactionId ?? undefined,
    referenceTransactionId: record.referenceTransactionId ?? undefined,
    status: record.status,
    failureCode: record.failureCode ?? undefined,
    createdAt: record.createdAt,
    processedAt: record.processedAt ?? undefined,
  });
