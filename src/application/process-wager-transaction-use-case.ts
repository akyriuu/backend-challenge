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
  WagerTransactionPendingReference,
  WagerTransactionProcessed,
  WagerTransactionRejected,
} from '@/domain/events/wager-transaction-events';
import type { EventContext } from '@/domain/events/integration-event';
import { Money } from '@/domain/money';
import {
  WagerTransaction,
  type WagerTransactionKind,
  type WagerTransactionStatus,
} from '@/domain/wager-transaction';
import type { Wallet } from '@/domain/wallet';
import { LedgerDirection } from '@/domain/wallet-ledger-entry';
import { IdempotencyConflictError, WalletNotFoundError } from './errors';

/** Acima disto, a aquisição do lock esperou por outra transação. */
const LOCK_CONTENTION_THRESHOLD_SECONDS = 0.05;

export interface ProcessWagerTransactionCommand {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  /** Presente apenas quando a origem é a fila: registra o inbox na mesma transação. */
  inbox?: {
    consumerName: string;
    messageId: string;
  };
  correlationId: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: Money;
  failureCode?: FailureCode;
  idempotentReplay: boolean;
}

@Injectable()
export class ProcessWagerTransaction {
  private readonly logger = new Logger(ProcessWagerTransaction.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWork,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional()
    @Inject(METRICS)
    private readonly metrics: Metrics = noopMetrics,
  ) {}

  async execute(
    command: ProcessWagerTransactionCommand,
  ): Promise<ProcessWagerTransactionResult> {
    return this.unitOfWork.run(async (context) => {
      /**
       * O lock da carteira vem primeiro e serializa tudo que a toca: inbox,
       * idempotência, resolução de referência e verificação de dupla reversão.
       * Sem ele, todas essas consultas seriam leituras sujeitas a corrida.
       */
      const wallet = await this.lockWallet(command.walletId, context);

      await this.registerInbox(command, context);

      const replay = await this.replayOf(command, context, wallet);

      if (replay) {
        return this.recorded(replay, command.kind);
      }

      const now = this.clock.now();
      const transaction = WagerTransaction.create({
        id: this.ids.next(),
        providerId: command.providerId,
        externalTransactionId: command.externalTransactionId,
        idempotencyKey: command.idempotencyKey,
        payloadHash: command.payloadHash,
        walletId: command.walletId,
        playerId: command.playerId,
        roundId: command.roundId,
        gameId: command.gameId,
        kind: command.kind,
        money: command.money,
        referenceExternalTransactionId: command.referenceExternalTransactionId,
        createdAt: now,
      });

      const events: EventContext = {
        eventId: this.ids.next(),
        correlationId: command.correlationId,
        occurredAt: now,
        causationId: transaction.id,
      };

      const reference = transaction.requiresReference()
        ? await context.transactions.findByProviderReference(
            transaction.providerId,
            transaction.referenceExternalTransactionId ?? '',
          )
        : null;

      if (transaction.requiresReference() && !reference) {
        transaction.markPendingReference();

        await context.transactions.add(transaction);
        await context.outbox.enqueue(
          WagerTransactionPendingReference.from(transaction, events),
        );

        return this.recorded(
          {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance,
            idempotentReplay: false,
          },
          command.kind,
        );
      }

      const rejection = await this.rejectionFor(
        wallet,
        transaction,
        reference,
        context,
      );

      if (rejection) {
        transaction.reject(rejection);

        await context.transactions.add(transaction);
        await context.outbox.enqueue(
          WagerTransactionRejected.from(transaction, rejection, events),
        );

        return this.recorded(
          {
            transactionId: transaction.id,
            status: transaction.status,
            balance: wallet.balance,
            failureCode: rejection,
            idempotentReplay: false,
          },
          command.kind,
        );
      }

      transaction.markProcessed(reference?.id, now);
      await context.transactions.add(transaction);

      if (transaction.affectsBalance()) {
        const movement = {
          entryId: this.ids.next(),
          transactionId: transaction.id,
          money: command.money,
          occurredAt: now,
        };

        const entry =
          transaction.ledgerDirectionFor(reference ?? undefined) ===
          LedgerDirection.DEBIT
            ? wallet.debit(movement)
            : wallet.credit(movement);

        await context.ledger.append(entry);
        await context.wallets.save(wallet);
        await context.outbox.enqueue(
          WalletBalanceChanged.from(wallet, entry, {
            ...events,
            eventId: this.ids.next(),
          }),
        );
      }

      await context.outbox.enqueue(
        WagerTransactionProcessed.from(transaction, events),
      );

      return this.recorded(
        {
          transactionId: transaction.id,
          status: transaction.status,
          balance: wallet.balance,
          idempotentReplay: false,
        },
        command.kind,
      );
    });
  }

  /**
   * Mede a espera pelo lock. Com bloqueio pessimista não existe "conflito" que
   * falhe — existe espera —, então é a duração da aquisição que revela carteira
   * quente, e não uma contagem de erros.
   */
  private async lockWallet(
    walletId: string,
    context: TransactionalContext,
  ): Promise<Wallet> {
    const startedAt = performance.now();
    const wallet = await context.wallets.findForUpdate(walletId);
    const waited = (performance.now() - startedAt) / 1000;

    this.metrics.observe('wager_wallet_lock_wait_seconds', waited);

    if (waited > LOCK_CONTENTION_THRESHOLD_SECONDS) {
      this.metrics.increment('wager_wallet_lock_contended_total');
    }

    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    return wallet;
  }

  private recorded(
    result: ProcessWagerTransactionResult,
    kind: WagerTransactionKind,
  ): ProcessWagerTransactionResult {
    this.metrics.increment('wager_transactions_total', {
      status: result.status,
      kind,
    });

    if (result.idempotentReplay) {
      this.metrics.increment('wager_idempotent_replays_total', { kind });
    }

    if (result.failureCode) {
      this.metrics.increment('wager_transactions_rejected_total', {
        failureCode: result.failureCode,
      });
    }

    return result;
  }

  /**
   * Reentrega não interrompe o fluxo: ela segue para o replay, que devolve o
   * resultado original. O inbox impede reprocessar; a chave de idempotência
   * garante a resposta certa. São camadas distintas, e é por isso que a seção 5
   * proíbe confiar apenas na deduplicação do broker.
   */
  private async registerInbox(
    command: ProcessWagerTransactionCommand,
    context: TransactionalContext,
  ): Promise<void> {
    if (!command.inbox) {
      return;
    }

    const primeiraEntrega = await context.inbox.register({
      consumerName: command.inbox.consumerName,
      messageId: command.inbox.messageId,
      payloadHash: command.payloadHash,
      receivedAt: this.clock.now(),
    });

    if (!primeiraEntrega) {
      this.metrics.increment('wager_inbox_duplicates_total', {
        consumerName: command.inbox.consumerName,
      });

      this.logger.log({
        message: 'mensagem já registrada no inbox, seguindo para replay',
        consumerName: command.inbox.consumerName,
        messageId: command.inbox.messageId,
      });
    }
  }

  /**
   * Regra 7 da seção 7: repetir uma operação já processada devolve o resultado
   * original, com o saldo observado naquele momento.
   */
  private async replayOf(
    command: ProcessWagerTransactionCommand,
    context: TransactionalContext,
    wallet: Wallet,
  ): Promise<ProcessWagerTransactionResult | null> {
    const existing = await context.transactions.findByIdempotencyKey(
      command.idempotencyKey,
    );

    if (!existing) {
      return null;
    }

    if (!existing.matchesPayload(command.payloadHash)) {
      this.metrics.increment('wager_idempotency_conflicts_total');

      throw new IdempotencyConflictError(command.idempotencyKey);
    }

    const entry = await context.ledger.findByTransaction(existing.id);

    return {
      transactionId: existing.id,
      status: existing.status,
      balance: entry?.balanceAfter ?? wallet.balance,
      failureCode: existing.failureCode,
      idempotentReplay: true,
    };
  }

  private async rejectionFor(
    wallet: Wallet,
    transaction: WagerTransaction,
    reference: WagerTransaction | null,
    context: TransactionalContext,
  ): Promise<FailureCode | undefined> {
    if (transaction.money.currency !== wallet.currency) {
      return FailureCode.CURRENCY_MISMATCH;
    }

    if (reference) {
      const invalid = transaction.validateReference(reference);

      if (invalid) {
        return invalid;
      }

      const jaRevertida = await context.transactions.hasReversal(
        reference.id,
        transaction.kind,
      );

      if (jaRevertida) {
        return FailureCode.REFERENCE_ALREADY_REVERSED;
      }
    }

    if (!transaction.affectsBalance()) {
      return undefined;
    }

    const debita =
      transaction.ledgerDirectionFor(reference ?? undefined) ===
      LedgerDirection.DEBIT;

    if (debita && wallet.balance.isLessThan(transaction.money)) {
      return transaction.isReversal()
        ? FailureCode.REVERSAL_WOULD_OVERDRAW
        : FailureCode.INSUFFICIENT_FUNDS;
    }

    return undefined;
  }
}
