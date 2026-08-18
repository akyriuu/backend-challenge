import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { Money } from '@/domain/money';
import { FailureCode } from '@/domain/failure-code';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';
import { IdempotencyConflictError } from '@/application/errors';

let orm: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);

/** Cada execução recebe seu próprio EntityManager: conexões distintas, concorrência real. */
const useCaseOn = (em: EntityManager): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(em),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );

const bet = (externalId: string, amount: string) => ({
  providerId: 'provider-a',
  externalTransactionId: externalId,
  idempotencyKey: `provider-a:${externalId}`,
  payloadHash: `hash-${externalId}`,
  walletId: WALLET_ID,
  playerId: PLAYER_ID,
  roundId: 'round-1',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.BET,
  money: brl(amount),
  correlationId: `correlation-${externalId}`,
});

const seedWallet = async (balance: string): Promise<void> => {
  await sql(`
    insert into wallets (id, player_id, currency, balance_amount, version)
    values ('${WALLET_ID}', '${PLAYER_ID}', 'BRL', '${balance}', 1);
  `);

  await sql(`
    insert into wager_transactions (
      id, provider_id, external_transaction_id, idempotency_key, payload_hash,
      wallet_id, player_id, round_id, game_id, kind, amount, currency,
      status, processed_at
    ) values (
      '${OPENING_TX_ID}', 'internal', 'opening-1', 'internal:opening-1', 'hash-opening',
      '${WALLET_ID}', '${PLAYER_ID}', 'opening', 'internal', 'OPENING', '${balance}', 'BRL',
      'PROCESSED', now()
    );
  `);

  await sql(`
    insert into wallet_ledger_entries (
      id, wallet_id, transaction_id, direction, amount, currency,
      balance_before, balance_after
    ) values (
      '${OPENING_ENTRY_ID}', '${WALLET_ID}', '${OPENING_TX_ID}', 'CREDIT',
      '${balance}', 'BRL', '0.00', '${balance}'
    );
  `);
};

/** A invariante que fecha o enunciado, verificada contra o banco. */
const assertWalletConsistent = async (walletId: string): Promise<void> => {
  const [row] = await sql<{
    stored: string;
    reconstructed: string;
    consistent: boolean;
  }>(`
    select
      w.balance_amount::text as stored,
      coalesce(sum(
        case when e.direction = 'DEBIT' then -e.amount else e.amount end
      ), 0)::text as reconstructed,
      w.balance_amount = coalesce(sum(
        case when e.direction = 'DEBIT' then -e.amount else e.amount end
      ), 0) as consistent
      from wallets w
      left join wallet_ledger_entries e on e.wallet_id = w.id
     where w.id = '${walletId}'
     group by w.balance_amount;
  `);

  expect(`saldo ${row?.stored} vs ledger ${row?.reconstructed}`).toBe(
    `saldo ${row?.stored} vs ledger ${row?.stored}`,
  );
  expect(row?.consistent).toBe(true);
};

beforeAll(async () => {
  orm = await MikroORM.init(config);
  await orm.migrator.up();
});

afterAll(async () => {
  await orm.close(true);
});

beforeEach(async () => {
  await sql(`
    truncate table
      wallet_ledger_entries, wager_transactions, wallets, outbox_messages
    cascade;
  `);
});

describe('BET sob concorrência', () => {
  it('duas apostas de 80 sobre saldo 100: uma passa, uma é rejeitada', async () => {
    await seedWallet('100.00');

    const results = await Promise.all([
      useCaseOn(orm.em.fork()).execute(bet('transaction-1', '80.00')),
      useCaseOn(orm.em.fork()).execute(bet('transaction-2', '80.00')),
    ]);

    const processadas = results.filter(
      (result) => result.status === WagerTransactionStatus.PROCESSED,
    );
    const rejeitadas = results.filter(
      (result) => result.status === WagerTransactionStatus.REJECTED,
    );

    expect(processadas).toHaveLength(1);
    expect(rejeitadas).toHaveLength(1);
    expect(rejeitadas[0]?.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);
    expect(processadas[0]?.balance.toString()).toBe('20.00');

    const [wallet] = await sql<{ balance: string; version: number }>(`
      select balance_amount::text as balance, version
        from wallets where id = '${WALLET_ID}';
    `);

    expect(wallet?.balance).toBe('20.00');
    expect(wallet?.version).toBe(2);

    const debitos = await sql<{ id: string }>(`
      select id from wallet_ledger_entries
       where wallet_id = '${WALLET_ID}' and direction = 'DEBIT';
    `);

    expect(debitos).toHaveLength(1);

    await assertWalletConsistent(WALLET_ID);
  });

  it('a rejeição não produz lançamento, mas fica auditável', async () => {
    await seedWallet('50.00');

    const result = await useCaseOn(orm.em.fork()).execute(
      bet('transaction-1', '80.00'),
    );

    expect(result.status).toBe(WagerTransactionStatus.REJECTED);
    expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

    const [persistida] = await sql<{ status: string; failure_code: string }>(`
      select status, failure_code from wager_transactions
       where idempotency_key = 'provider-a:transaction-1';
    `);

    expect(persistida?.status).toBe('REJECTED');
    expect(persistida?.failure_code).toBe('INSUFFICIENT_FUNDS');

    const debitos = await sql(`
      select id from wallet_ledger_entries where direction = 'DEBIT';
    `);

    expect(debitos).toHaveLength(0);
    await assertWalletConsistent(WALLET_ID);
  });

  it('o evento nasce na mesma transação do débito', async () => {
    await seedWallet('100.00');

    await useCaseOn(orm.em.fork()).execute(bet('transaction-1', '80.00'));

    const eventos = await sql<{
      event_type: string;
      published_at: string | null;
    }>(`
      select event_type, published_at from outbox_messages order by occurred_at;
    `);

    expect(eventos.map((evento) => evento.event_type).sort()).toEqual([
      'WagerTransactionProcessed',
      'WalletBalanceChanged',
    ]);
    expect(eventos.every((evento) => evento.published_at === null)).toBe(true);
  });
});

it('a mesma aposta enviada 50 vezes em paralelo produz um único débito', async () => {
  await seedWallet('100.00');

  const results = await Promise.all(
    Array.from({ length: 50 }, () =>
      useCaseOn(orm.em.fork()).execute(bet('transaction-1', '80.00')),
    ),
  );

  const originais = results.filter((result) => !result.idempotentReplay);
  const replays = results.filter((result) => result.idempotentReplay);

  expect(originais).toHaveLength(1);
  expect(replays).toHaveLength(49);
  expect(new Set(results.map((result) => result.transactionId)).size).toBe(1);
  expect(results.every((result) => result.balance.toString() === '20.00')).toBe(
    true,
  );

  const debitos = await sql(`
      select id from wallet_ledger_entries where direction = 'DEBIT';
    `);

  expect(debitos).toHaveLength(1);

  const [wallet] = await sql<{ balance: string; version: number }>(`
      select balance_amount::text as balance, version
        from wallets where id = '${WALLET_ID}';
    `);

  expect(wallet?.balance).toBe('20.00');
  expect(wallet?.version).toBe(2);

  await assertWalletConsistent(WALLET_ID);
});

it('mesma chave com payload diferente é conflito, não replay', async () => {
  await seedWallet('100.00');

  await useCaseOn(orm.em.fork()).execute(bet('transaction-1', '10.00'));

  const conflitante = {
    ...bet('transaction-1', '20.00'),
    payloadHash: 'hash-diferente',
  };

  const falha = await useCaseOn(orm.em.fork())
    .execute(conflitante)
    .then(
      () => null,
      (error: unknown) => error,
    );

  expect(falha).toBeInstanceOf(IdempotencyConflictError);

  const transacoes = await sql(`
      select id from wager_transactions where kind = 'BET';
    `);

  expect(transacoes).toHaveLength(1);
  await assertWalletConsistent(WALLET_ID);
});
