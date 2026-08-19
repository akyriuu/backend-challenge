import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { InvalidCursorError } from '@/application/errors';

export interface MoneyView {
  amount: string;
  currency: string;
}

export interface WalletView {
  id: string;
  playerId: string;
  balance: MoneyView;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntryView {
  id: string;
  transactionId: string;
  direction: string;
  money: MoneyView;
  balanceBefore: MoneyView;
  balanceAfter: MoneyView;
  createdAt: string;
}

export interface LedgerPage {
  entries: LedgerEntryView[];
  nextCursor: string | null;
}

export interface TransactionView {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: string;
  money: MoneyView;
  status: string;
  failureCode: string | null;
  referenceExternalTransactionId: string | null;
  referenceTransactionId: string | null;
  createdAt: string;
  processedAt: string | null;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * O driver devolve timestamp como string em consulta crua, e como `Date` quando
 * há hidratação de entidade. Emitir ISO-8601 direto do PostgreSQL elimina a
 * ambiguidade em vez de adivinhar o tipo do outro lado.
 */
const ISO = (column: string): string => `to_json(${column}) #>> '{}'`;

/** Cursor opaco: quem consome não deve depender do formato para paginar. */
const encodeCursor = (createdAt: string, id: string): string =>
  Buffer.from(`${createdAt}|${id}`).toString('base64url');

const decodeCursor = (cursor: string): { createdAt: string; id: string } => {
  const [createdAt, id] = Buffer.from(cursor, 'base64url')
    .toString()
    .split('|');

  if (!createdAt || !id || Number.isNaN(Date.parse(createdAt))) {
    throw new InvalidCursorError(cursor);
  }

  return { createdAt, id };
};

/**
 * Consultas não passam pelos agregados de propósito. Reidratar `Wallet` para
 * depois serializá-la seria trabalho puro: leitura não tem invariante a
 * proteger, e o modelo de escrita não deve ditar o formato de leitura.
 */
@Injectable()
export class WageringQueries {
  constructor(private readonly em: EntityManager) {}

  async wallet(walletId: string): Promise<WalletView | null> {
    const rows = await this.em.getConnection().execute<
      {
        id: string;
        player_id: string;
        currency: string;
        balance: string;
        version: number;
        created_at: string;
        updated_at: string;
      }[]
    >(
      `select id, player_id, currency, balance_amount::text as balance, version,
              ${ISO('created_at')} as created_at,
              ${ISO('updated_at')} as updated_at
         from wallets where id = ?`,
      [walletId],
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      playerId: row.player_id,
      balance: { amount: row.balance, currency: row.currency },
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Paginação por chave composta `(created_at, id)`, alinhada ao índice
   * `wallet_ledger_entries_cursor_idx`. Offset degradaria linearmente e ainda
   * pularia ou repetiria linhas quando houvesse inserção durante a leitura —
   * num ledger append-only isso é o caso comum, não a exceção.
   */
  async ledger(
    walletId: string,
    options: { cursor?: string; limit?: number },
  ): Promise<LedgerPage> {
    const limit = Math.min(
      Math.max(options.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const filter = options.cursor ? decodeCursor(options.cursor) : null;
    const predicate = filter
      ? `and (created_at, id) < (?::timestamptz, ?::uuid)`
      : '';
    const params = filter
      ? [walletId, filter.createdAt, filter.id, limit + 1]
      : [walletId, limit + 1];

    const rows = await this.em.getConnection().execute<
      {
        id: string;
        transaction_id: string;
        direction: string;
        amount: string;
        currency: string;
        balance_before: string;
        balance_after: string;
        created_at: string;
      }[]
    >(
      `select id, transaction_id, direction, amount::text as amount, currency,
              balance_before::text as balance_before,
              balance_after::text as balance_after,
              ${ISO('created_at')} as created_at
         from wallet_ledger_entries
        where wallet_id = ? ${predicate}
        order by created_at desc, id desc
        limit ?`,
      params,
    );

    /** Uma linha a mais revela se há próxima página, sem um count adicional. */
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      entries: page.map((row) => ({
        id: row.id,
        transactionId: row.transaction_id,
        direction: row.direction,
        money: { amount: row.amount, currency: row.currency },
        balanceBefore: { amount: row.balance_before, currency: row.currency },
        balanceAfter: { amount: row.balance_after, currency: row.currency },
        createdAt: row.created_at,
      })),
      nextCursor:
        hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  async transactionById(id: string): Promise<TransactionView | null> {
    return this.transactionWhere(`id = ?`, [id]);
  }

  async transactionByProviderReference(
    providerId: string,
    externalTransactionId: string,
  ): Promise<TransactionView | null> {
    return this.transactionWhere(
      `provider_id = ? and external_transaction_id = ?`,
      [providerId, externalTransactionId],
    );
  }

  private async transactionWhere(
    predicate: string,
    params: unknown[],
  ): Promise<TransactionView | null> {
    const rows = await this.em.getConnection().execute<
      {
        id: string;
        provider_id: string;
        external_transaction_id: string;
        idempotency_key: string;
        wallet_id: string;
        player_id: string;
        round_id: string;
        game_id: string;
        kind: string;
        amount: string;
        currency: string;
        status: string;
        failure_code: string | null;
        reference_external_transaction_id: string | null;
        reference_transaction_id: string | null;
        created_at: string;
        processed_at: string | null;
      }[]
    >(
      `select id, provider_id, external_transaction_id, idempotency_key,
              wallet_id, player_id, round_id, game_id, kind,
              amount::text as amount, currency, status, failure_code,
              reference_external_transaction_id, reference_transaction_id,
              ${ISO('created_at')} as created_at,
              ${ISO('processed_at')} as processed_at
         from wager_transactions where ${predicate}`,
      params,
    );

    const row = rows[0];

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      providerId: row.provider_id,
      externalTransactionId: row.external_transaction_id,
      idempotencyKey: row.idempotency_key,
      walletId: row.wallet_id,
      playerId: row.player_id,
      roundId: row.round_id,
      gameId: row.game_id,
      kind: row.kind,
      money: { amount: row.amount, currency: row.currency },
      status: row.status,
      failureCode: row.failure_code,
      referenceExternalTransactionId: row.reference_external_transaction_id,
      referenceTransactionId: row.reference_transaction_id,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  }
}
