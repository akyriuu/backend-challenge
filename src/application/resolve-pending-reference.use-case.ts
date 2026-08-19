import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  UNIT_OF_WORK,
  type TransactionalContext,
  type UnitOfWork,
} from './ports/unit-of-work';
import {
  CLOCK,
  ID_GENERATOR,
  type Clock,
  type IdGenerator,
} from './ports/system';
import { METRICS, noopMetrics, type Metrics } from './ports/metrics';
import { FailureCode } from '@/domain/failure-code';
import { WalletBalanceChanged } from '@/domain/events/wallet-balance-changed';
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '@/domain/events/wager-transaction-events';
import type { EventContext } from '@/domain/events/integration-event';
import {
  WagerTransactionStatus,
  type WagerTransaction,
} from '@/domain/wager-transaction';
import type { Wallet } from '@/domain/wallet';
import { LedgerDirection } from '@/domain/wallet-ledger-entry';

export type PendingReferenceOutcome =
  'processed' | 'rejected' | 'still-pending' | 'skipped';

@Injectable()
export class ResolvePendingReference {
  private readonly logger = new Logger(ResolvePendingReference.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional()
    @Inject(METRICS)
    private readonly metrics: Metrics = noopMetrics,
  ) {}

  /** Tenta resolver uma reversão pendente. Sem referência ainda, agenda outra tentativa. */
  async execute(transactionId: string): Promise<PendingReferenceOutcome> {
    const outcome = await this.unitOfWork.run(async (context) => {
      const pending = await this.lockAndReload(transactionId, context);

      if (!pending) {
        return 'skipped' as const;
      }

      const { transaction, wallet } = pending;
      const now = this.clock.now();
      const events: EventContext = {
        eventId: this.ids.next(),
        correlationId: transaction.id,
        causationId: transaction.id,
        occurredAt: now,
      };

      const reference = await context.transactions.findByProviderReference(
        transaction.providerId,
        transaction.referenceExternalTransactionId ?? '',
      );

      if (!reference) {
        await context.transactions.delayReferenceRetry(transaction.id);

        return 'still-pending' as const;
      }

      const rejection = await this.rejectionFor(
        wallet,
        transaction,
        reference,
        context,
      );

      if (rejection) {
        transaction.reject(rejection);

        await context.transactions.update(transaction);
        await context.outbox.enqueue(
          WagerTransactionRejected.from(transaction, rejection, events),
        );

        return 'rejected' as const;
      }

      transaction.markProcessed(reference.id, now);
      await context.transactions.update(transaction);

      const entry =
        transaction.ledgerDirectionFor(reference) === LedgerDirection.DEBIT
          ? wallet.debit({
              entryId: this.ids.next(),
              transactionId: transaction.id,
              money: transaction.money,
              occurredAt: now,
            })
          : wallet.credit({
              entryId: this.ids.next(),
              transactionId: transaction.id,
              money: transaction.money,
              occurredAt: now,
            });

      await context.ledger.append(entry);
      await context.wallets.save(wallet);
      await context.outbox.enqueue(
        WalletBalanceChanged.from(wallet, entry, {
          ...events,
          eventId: this.ids.next(),
        }),
      );
      await context.outbox.enqueue(
        WagerTransactionProcessed.from(transaction, {
          ...events,
          eventId: this.ids.next(),
        }),
      );

      return 'processed' as const;
    });

    this.metrics.increment('wager_pending_reference_total', { outcome });

    return outcome;
  }

  /** Esgotado o limite de tentativas, a reversão órfã vira rejeição auditável. */
  async expire(transactionId: string): Promise<PendingReferenceOutcome> {
    const outcome = await this.unitOfWork.run(async (context) => {
      const pending = await this.lockAndReload(transactionId, context);

      if (!pending) {
        return 'skipped' as const;
      }

      const { transaction } = pending;

      transaction.reject(FailureCode.REFERENCE_NOT_FOUND);

      await context.transactions.update(transaction);
      await context.outbox.enqueue(
        WagerTransactionRejected.from(
          transaction,
          FailureCode.REFERENCE_NOT_FOUND,
          {
            eventId: this.ids.next(),
            correlationId: transaction.id,
            causationId: transaction.id,
            occurredAt: this.clock.now(),
          },
        ),
      );

      this.logger.warn({
        message: 'reversão descartada por referência inexistente',
        transactionId: transaction.id,
        walletId: transaction.walletId,
        providerId: transaction.providerId,
        referenceExternalTransactionId:
          transaction.referenceExternalTransactionId,
      });

      return 'rejected' as const;
    });

    this.metrics.increment('wager_pending_reference_total', {
      outcome: 'expired',
    });

    return outcome;
  }

  private async lockAndReload(
    transactionId: string,
    context: TransactionalContext,
  ): Promise<{ transaction: WagerTransaction; wallet: Wallet } | null> {
    const candidate = await context.transactions.findById(transactionId);

    if (!candidate) {
      return null;
    }

    const wallet = await context.wallets.findForUpdate(candidate.walletId);

    if (!wallet) {
      return null;
    }

    const transaction = await context.transactions.findById(transactionId);

    if (
      !transaction ||
      transaction.status !== WagerTransactionStatus.PENDING_REFERENCE
    ) {
      return null;
    }

    return { transaction, wallet };
  }

  private async rejectionFor(
    wallet: Wallet,
    transaction: WagerTransaction,
    reference: WagerTransaction,
    context: TransactionalContext,
  ): Promise<FailureCode | undefined> {
    const invalid = transaction.validateReference(reference);

    if (invalid) {
      return invalid;
    }

    if (
      await context.transactions.hasReversal(reference.id, transaction.kind)
    ) {
      return FailureCode.REFERENCE_ALREADY_REVERSED;
    }

    if (
      transaction.ledgerDirectionFor(reference) === LedgerDirection.DEBIT &&
      wallet.balance.isLessThan(transaction.money)
    ) {
      return FailureCode.REVERSAL_WOULD_OVERDRAW;
    }

    return undefined;
  }
}
