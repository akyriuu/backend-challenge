import type { FailureCode } from '../failure-code';
import type { MoneyProps } from '../money';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '../wager-transaction';
import { IntegrationEvent, type EventContext } from './integration-event';

interface WagerTransactionData {
  transactionId: string;
  providerId: string;
  externalTransactionId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
}

const describe = (transaction: WagerTransaction): WagerTransactionData => ({
  transactionId: transaction.id,
  providerId: transaction.providerId,
  externalTransactionId: transaction.externalTransactionId,
  walletId: transaction.walletId,
  playerId: transaction.playerId,
  roundId: transaction.roundId,
  kind: transaction.kind,
  money: transaction.money.toJSON(),
});

export interface WagerTransactionProcessedData extends WagerTransactionData {
  processedAt: string;
}

export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      ...context,
      aggregateId: transaction.walletId,
      data: {
        ...describe(transaction),
        processedAt: (
          transaction.processedAt ?? context.occurredAt
        ).toISOString(),
      },
    });
  }
}

export interface WagerTransactionRejectedData extends WagerTransactionData {
  failureCode: FailureCode;
}

export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    failureCode: FailureCode,
    context: EventContext,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected({
      ...context,
      aggregateId: transaction.walletId,
      data: { ...describe(transaction), failureCode },
    });
  }
}

export interface WagerTransactionPendingReferenceData extends WagerTransactionData {
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(
    transaction: WagerTransaction,
    context: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      ...context,
      aggregateId: transaction.walletId,
      data: {
        ...describe(transaction),
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId ?? '',
      },
    });
  }
}
