import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import type { ProcessWagerTransactionResult } from '@/application/process-wager-transaction-use-case';
import { FailureCode } from '@/domain/failure-code';
import { Money } from '@/domain/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';

const INSTANCES = 3;

/**
 * Cada "instância" é uma MikroORM própria, com pool de conexões e identity map
 * independentes. Do ponto de vista do banco — que é onde as invariantes vivem —
 * isso é indistinguível de três processos: o único estado compartilhado é o
 * PostgreSQL. Processos de sistema operacional separados provariam isolamento de
 * memória, que não influencia locking.
 */
let instances: MikroORM[] = [];
let admin: MikroORM;

const sql = async <T>(statement: string): Promise<T[]> =>
  admin.em.getConnection().execute<T[]>(statement);

const useCaseOf = (instance: MikroORM): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(instance.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );

const bet = (walletId: string, externalId: string, amount: string) => ({
  providerId: 'provider-a',
  externalTransactionId: externalId,
  idempotencyKey: `provider-a:${externalId}`,
  payloadHash: `hash-${externalId}`,
  walletId,
  playerId: walletId,
  roundId: 'round-1',
  gameId: 'fortune-chimp',
  kind: WagerTransactionKind.BET,
  money: Money.from({ amount, currency: 'BRL' }),
  correlationId: `correlation-${externalId}`,
});

const seedWallet = async (walletId: string, balance: string): Promise<void> => {
  const openingTxId = Bun.randomUUIDv7();

  await sql(`
    insert into wallets (id, player_id, currency, balance_amount, version)
    values ('${walletId}', '${walletId}', 'BRL', '${balance}', 1);
  `);
  await sql(`
    insert into wager_transactions (
      id, provider_id, external_transaction_id, idempotency_key, payload_hash,
      wallet_id, player_id, round_id, game_id, kind, amount, currency,
      status, processed_at
    ) values (
      '${openingTxId}', 'internal', 'opening-${walletId}',
      'internal:opening-${walletId}', 'hash-opening', '${walletId}',
      '${walletId}', 'opening', 'internal', 'OPENING', '${balance}', 'BRL',
      'PROCESSED', now()
    );
  `);
  await sql(`
    insert into wallet_ledger_entries (
      id, wallet_id, transaction_id, direction, amount, currency,
      balance_before, balance_after
    ) values (
      '${Bun.randomUUIDv7()}', '${walletId}', '${openingTxId}', 'CREDIT',
      '${balance}', 'BRL', '0.00', '${balance}'
    );
  `);
};

const assertConsistent = async (walletId: string): Promise<void> => {
  const [row] = await sql<{ consistent: boolean }>(`
    select w.balance_amount = coalesce(sum(
      case when e.direction = 'DEBIT' then -e.amount else e.amount end
    ), 0) as consistent
      from wallets w
      left join wallet_ledger_entries e on e.wallet_id = w.id
     where w.id = '${walletId}'
     group by w.balance_amount;
  `);

  expect(row?.consistent).toBe(true);
};

beforeAll(async () => {
  admin = await MikroORM.init(config);
  await admin.migrator.up();

  instances = await Promise.all(
    Array.from({ length: INSTANCES }, () => MikroORM.init(config)),
  );
});

afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.close(true)));
  await admin.close(true);
});

beforeEach(async () => {
  await sql(`
    truncate table
      wallet_ledger_entries, wager_transactions, wallets, outbox_messages
    cascade;
  `);
});

describe(`concorrência com ${INSTANCES} instâncias`, () => {
  it('três instâncias disputando a mesma carteira respeitam o saldo', async () => {
    const walletId = Bun.randomUUIDv7();
    await seedWallet(walletId, '100.00');

    const results = await Promise.all(
      instances.map((instance, index) =>
        useCaseOf(instance).execute(bet(walletId, `bet-${index}`, '40.00')),
      ),
    );

    const processadas = results.filter(
      (result) => result.status === WagerTransactionStatus.PROCESSED,
    );
    const rejeitadas = results.filter(
      (result) => result.status === WagerTransactionStatus.REJECTED,
    );

    expect(processadas).toHaveLength(2);
    expect(rejeitadas).toHaveLength(1);
    expect(rejeitadas[0]?.failureCode).toBe(FailureCode.INSUFFICIENT_FUNDS);

    const [wallet] = await sql<{ balance: string; version: number }>(`
      select balance_amount::text as balance, version
        from wallets where id = '${walletId}';
    `);

    expect(wallet?.balance).toBe('20.00');
    expect(wallet?.version).toBe(3);

    const debitos = await sql(`
      select id from wallet_ledger_entries
       where wallet_id = '${walletId}' and direction = 'DEBIT';
    `);

    expect(debitos).toHaveLength(2);
    await assertConsistent(walletId);
  });

  it('carteiras distintas não bloqueiam umas às outras', async () => {
    const walletIds = Array.from({ length: INSTANCES }, () =>
      Bun.randomUUIDv7(),
    );

    await Promise.all(
      walletIds.map((walletId) => seedWallet(walletId, '100.00')),
    );

    const results = await Promise.all(
      walletIds.flatMap((walletId, wallet) =>
        instances.map((instance, index) =>
          useCaseOf(instance).execute(
            bet(walletId, `bet-${wallet}-${index}`, '10.00'),
          ),
        ),
      ),
    );

    expect(
      results.every(
        (result: ProcessWagerTransactionResult) =>
          result.status === WagerTransactionStatus.PROCESSED,
      ),
    ).toBe(true);

    for (const walletId of walletIds) {
      const [wallet] = await sql<{ balance: string }>(`
        select balance_amount::text as balance from wallets where id = '${walletId}';
      `);

      expect(wallet?.balance).toBe('70.00');
      await assertConsistent(walletId);
    }
  });
});
