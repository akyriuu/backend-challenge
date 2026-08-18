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
import { ReconcileWallet } from '@/application/reconcile-wallet.use-case';
import { Money } from '@/domain/money';
import { WagerTransactionKind } from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';

let orm: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);

const process = (): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(orm.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );

const reconcile = (): ReconcileWallet =>
  new ReconcileWallet(new MikroOrmUnitOfWork(orm.em.fork()));

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
  money: Money.from({ amount, currency: 'BRL' }),
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
        '${OPENING_TX_ID}', 'internal', 'opening-1', 'internal:opening-1',
        'hash-opening', '${WALLET_ID}', '${PLAYER_ID}', 'opening', 'internal',
        'OPENING', '${balance}', 'BRL', 'PROCESSED', now()
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
  await seedWallet('100.00');
});

describe('reconciliação', () => {
  it('confirma consistência depois de movimentações reais', async () => {
    await process().execute(bet('bet-1', '30.00'));
    await process().execute(bet('bet-2', '25.00'));

    const result = await reconcile().execute(WALLET_ID);

    expect(result.consistent).toBe(true);
    expect(result.storedBalance.toString()).toBe('45.00');
    expect(result.calculatedBalance.toString()).toBe('45.00');
    expect(result.difference.toString()).toBe('0.00');
    expect(result.checkedEntries).toBe(3);
  });

  it('reporta divergência quando o saldo é alterado por fora do ledger', async () => {
    await process().execute(bet('bet-1', '30.00'));

    await sql(`
        update wallets set balance_amount = '80.00' where id = '${WALLET_ID}';
      `);

    const result = await reconcile().execute(WALLET_ID);

    expect(result.consistent).toBe(false);
    expect(result.storedBalance.toString()).toBe('80.00');
    expect(result.calculatedBalance.toString()).toBe('70.00');
    expect(result.difference.toString()).toBe('10.00');
    expect(result.checkedEntries).toBe(2);
  });

  it('reporta diferença negativa quando o ledger supera o saldo', async () => {
    await process().execute(bet('bet-1', '30.00'));

    await sql(`
        update wallets set balance_amount = '60.00' where id = '${WALLET_ID}';
      `);

    const result = await reconcile().execute(WALLET_ID);

    expect(result.consistent).toBe(false);
    expect(result.difference.toString()).toBe('-10.00');
  });

  it('não corrige a divergência que encontrou', async () => {
    await sql(`
        update wallets set balance_amount = '999.00' where id = '${WALLET_ID}';
      `);

    await reconcile().execute(WALLET_ID);

    const [wallet] = await sql<{ balance: string }>(`
        select balance_amount::text as balance from wallets where id = '${WALLET_ID}';
      `);

    expect(wallet?.balance).toBe('999.00');
  });
});
