import { Injectable } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { IntegrationEvent } from '@/domain/events/integration-event';
import type {
  WagerTransaction,
  WagerTransactionKind,
} from '@/domain/wager-transaction';
import type { Wallet } from '@/domain/wallet';
import type { WalletLedgerEntry } from '@/domain/wallet-ledger-entry';
import { WalletAlreadyExistsError } from '@/application/errors';
import type {
  InboxEntry,
  InboxRepository,
  LedgerRepository,
  LedgerSummary,
  OutboxRepository,
  TransactionalContext,
  UnitOfWork,
  WagerTransactionRepository,
  WalletRepository,
} from '@/application/ports/unit-of-work';
import {
  toLedgerEntryDomain,
  toLedgerEntryRecordData,
} from './mappers/wallet-ledger-entry.mapper';
import {
  toWagerTransactionDomain,
  toWagerTransactionRecordData,
} from './mappers/wager-transaction.mapper';
import { applyWalletToRecord, toWalletDomain } from './mappers/wallet.mapper';
import { OutboxMessageSchema } from './schemas/outbox-message.schema';
import { WagerTransactionSchema } from './schemas/wager-transaction.schema';
import {
  WalletLedgerEntrySchema,
  type WalletLedgerEntryRecord,
} from './schemas/wallet-ledger-entry.schema';
import { WalletSchema, type WalletRecord } from './schemas/wallet.schema';
class MikroOrmWalletRepository implements WalletRepository {
  private readonly loaded = new Map<string, WalletRecord>();
  constructor(private readonly em: EntityManager) {}
  async findForUpdate(walletId: string): Promise<Wallet | null> {
    const record = await this.em.findOne(
      WalletSchema,
      { id: walletId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!record) {
      return null;
    }
    this.loaded.set(walletId, record);
    return toWalletDomain(record);
  }
  /**
   * A unicidade por (playerId, currency) é do banco. Verificar antes com um
   * select abriria janela de corrida entre instâncias; aqui só traduzimos a
   * violação para um erro que a camada HTTP sabe mapear como conflito.
   */
  async add(wallet: Wallet): Promise<void> {
    this.em.create(WalletSchema, {
      id: wallet.id,
      playerId: wallet.playerId,
      currency: wallet.currency,
      balanceAmount: wallet.balance.toString(),
      version: wallet.version,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt,
    });
    try {
      await this.em.flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new WalletAlreadyExistsError(wallet.playerId, wallet.currency);
      }
      throw error;
    }
  }
  async save(wallet: Wallet): Promise<void> {
    const record = this.loaded.get(wallet.id);
    if (!record) {
      throw new Error(
        `carteira ${wallet.id} não foi carregada sob lock nesta transação`,
      );
    }
    applyWalletToRecord(wallet, record);
    await this.em.flush();
  }
}
class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WagerTransaction | null> {
    const record = await this.em.findOne(WagerTransactionSchema, {
      idempotencyKey,
    });
    return record ? toWagerTransactionDomain(record) : null;
  }
  /** Regra 2 da seção 7: a referência é resolvida pelo id do provedor. */
  async findByProviderReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const record = await this.em.findOne(WagerTransactionSchema, {
      providerId,
      externalTransactionId,
    });
    return record ? toWagerTransactionDomain(record) : null;
  }
  async hasReversal(
    referenceTransactionId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    const existing = await this.em.count(WagerTransactionSchema, {
      referenceTransactionId,
      kind,
    });
    return existing > 0;
  }
  async add(transaction: WagerTransaction): Promise<void> {
    this.em.create(
      WagerTransactionSchema,
      toWagerTransactionRecordData(transaction),
    );
    await this.em.flush();
  }
}
class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}
  async append(entry: WalletLedgerEntry): Promise<void> {
    this.em.create(WalletLedgerEntrySchema, toLedgerEntryRecordData(entry));
    await this.em.flush();
  }
  async findByTransaction(
    transactionId: string,
  ): Promise<WalletLedgerEntry | null> {
    const record: WalletLedgerEntryRecord | null = await this.em.findOne(
      WalletLedgerEntrySchema,
      { transactionId },
    );
    return record ? toLedgerEntryDomain(record) : null;
  }
  async summarize(walletId: string): Promise<LedgerSummary> {
    const rows = await this.em.getConnection().execute<LedgerSummary[]>(
      `select
         coalesce(sum(amount) filter (where direction = 'DEBIT'), 0)::text as debits,
         coalesce(sum(amount) filter (where direction = 'CREDIT'), 0)::text as credits,
         count(*)::int as entries
         from wallet_ledger_entries
        where wallet_id = ?`,
      [walletId],
    );
    return rows[0] ?? { debits: '0', credits: '0', entries: 0 };
  }
}
class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}
  /**
   * `on conflict do nothing` em vez de inserir e capturar a violação: no
   * PostgreSQL um erro de constraint aborta a transação inteira, e capturar a
   * exceção em JavaScript não a desfaz — todo comando seguinte falharia com
   * "current transaction is aborted".
   *
   * `received_at` e `processed_at` recebem o mesmo instante porque registro e
   * processamento são atômicos: se a transação abortar, a linha some junto.
   */
  async register(entry: InboxEntry): Promise<boolean> {
    const rows = await this.em
      .getConnection()
      .execute<{ message_id: string }[]>(
        `insert into inbox_messages
           (consumer_name, message_id, payload_hash, received_at, processed_at)
         values (?, ?, ?, ?, ?)
         on conflict (consumer_name, message_id) do nothing
         returning message_id`,
        [
          entry.consumerName,
          entry.messageId,
          entry.payloadHash,
          entry.receivedAt,
          entry.receivedAt,
        ],
      );
    return rows.length > 0;
  }
}
class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}
  async enqueue(event: IntegrationEvent<object>): Promise<void> {
    const envelope = event.toJSON();
    this.em.create(OutboxMessageSchema, {
      id: envelope.eventId,
      aggregateId: envelope.aggregateId,
      eventType: envelope.eventType,
      payload: envelope as unknown as Record<string, unknown>,
      occurredAt: event.occurredAt,
      attempts: 0,
      nextAttemptAt: null,
      publishedAt: null,
    });
    await this.em.flush();
  }
}
@Injectable()
export class MikroOrmUnitOfWork implements UnitOfWork {
  constructor(private readonly em: EntityManager) {}
  run<T>(work: (context: TransactionalContext) => Promise<T>): Promise<T> {
    return this.em.transactional((tx: EntityManager) =>
      work({
        wallets: new MikroOrmWalletRepository(tx),
        transactions: new MikroOrmWagerTransactionRepository(tx),
        ledger: new MikroOrmLedgerRepository(tx),
        inbox: new MikroOrmInboxRepository(tx),
        outbox: new MikroOrmOutboxRepository(tx),
      }),
    );
  }
}
