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
import type { ProcessWagerTransactionCommand } from '@/application/process-wager-transaction-use-case';
import { ResolvePendingReference } from '@/application/resolve-pending-reference.use-case';
import { Money } from '@/domain/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmPendingReferenceStore } from '@/infrastructure/database/mikro-orm.pending-reference-store';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';
import { PendingReferenceWorker } from '@/infrastructure/messaging/pending-reference.worker';

let orm: MikroORM;
let second: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);

const process = (instance: MikroORM = orm): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(instance.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );

const workerOn = (instance: MikroORM): PendingReferenceWorker =>
  new PendingReferenceWorker(
    new MikroOrmPendingReferenceStore(instance.em.fork()),
    new ResolvePendingReference(
      new MikroOrmUnitOfWork(instance.em.fork()),
      { next: () => Bun.randomUUIDv7() },
      { now: () => new Date() },
    ),
  );

const command = (
  kind: WagerTransactionKind,
  externalId: string,
  amount: string,
  referenceExternalTransactionId?: string,
): ProcessWagerTransactionCommand => ({
  providerId: 'provider-a',
  externalTransactionId: externalId,
  idempotencyKey: `provider-a:${externalId}`,
  payloadHash: `hash-${externalId}`,
  walletId: WALLET_ID,
  playerId: PLAYER_ID,
  roundId: 'round-1',
  gameId: 'fortune-chimp',
  kind,
  money: Money.from({ amount, currency: 'BRL' }),
  referenceExternalTransactionId,
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

/** Envelhece a pendência para que o backoff já tenha vencido. */
const tornarElegivel = async (transactionId: string): Promise<void> => {
  await sql(`
      update wager_transactions
         set created_at = now() - interval '1 hour'
       where id = '${transactionId}';
    `);
};

const estadoDe = async (
  transactionId: string,
): Promise<{
  status: string;
  failure_code: string | null;
  tentativas: number;
}> => {
  const [row] = await sql<{
    status: string;
    failure_code: string | null;
    tentativas: number;
  }>(`
      select status, failure_code, reference_attempts as tentativas
        from wager_transactions where id = '${transactionId}';
    `);

  return row ?? { status: '', failure_code: null, tentativas: -1 };
};

const saldo = async (): Promise<string> => {
  const [row] = await sql<{ balance: string }>(`
      select balance_amount::text as balance from wallets where id = '${WALLET_ID}';
    `);

  return row?.balance ?? '';
};

const lancamentos = async (): Promise<number> => {
  const rows = await sql(`
      select id from wallet_ledger_entries where wallet_id = '${WALLET_ID}';
    `);

  return rows.length;
};

beforeAll(async () => {
  orm = await MikroORM.init(config);
  await orm.migrator.up();
  second = await MikroORM.init(config);
});

afterAll(async () => {
  await second.close(true);
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

describe('referências fora de ordem', () => {
  it('resolve o estorno quando a aposta finalmente chega', async () => {
    const refund = await process().execute(
      command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
    );

    expect(refund.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);

    await process().execute(
      command(WagerTransactionKind.BET, 'bet-1', '80.00'),
    );

    expect(await saldo()).toBe('20.00');

    await tornarElegivel(refund.transactionId);
    await workerOn(orm).runOnce();

    expect(await saldo()).toBe('100.00');
    expect(await lancamentos()).toBe(3);

    const estado = await estadoDe(refund.transactionId);

    expect(estado.status).toBe('PROCESSED');
  });

  it('sem a referência, agenda nova tentativa e continua pendente', async () => {
    const refund = await process().execute(
      command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'nunca-chega'),
    );

    await tornarElegivel(refund.transactionId);
    await workerOn(orm).runOnce();

    const estado = await estadoDe(refund.transactionId);

    expect(estado.status).toBe('PENDING_REFERENCE');
    expect(estado.tentativas).toBe(1);
    expect(await lancamentos()).toBe(1);
  });

  it('não revisita antes de o backoff vencer', async () => {
    const refund = await process().execute(
      command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'nunca-chega'),
    );

    /** Cinco tentativas equivalem a 32 segundos de espera; created_at é agora. */
    await sql(`
        update wager_transactions set reference_attempts = 5
         where id = '${refund.transactionId}';
      `);

    await workerOn(orm).runOnce();

    expect((await estadoDe(refund.transactionId)).tentativas).toBe(5);
  });

  it('esgotado o limite, rejeita com REFERENCE_NOT_FOUND', async () => {
    const refund = await process().execute(
      command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'nunca-chega'),
    );

    await sql(`
        update wager_transactions set reference_attempts = 12
         where id = '${refund.transactionId}';
      `);

    await workerOn(orm).runOnce();

    const estado = await estadoDe(refund.transactionId);

    expect(estado.status).toBe('REJECTED');
    expect(estado.failure_code).toBe('REFERENCE_NOT_FOUND');
    expect(await saldo()).toBe('100.00');
    expect(await lancamentos()).toBe(1);

    const eventos = await sql<{ event_type: string }>(`
        select event_type from outbox_messages
         where event_type = 'WagerTransactionRejected';
      `);

    expect(eventos).toHaveLength(1);
  });

  it('dois workers concorrentes não aplicam o estorno duas vezes', async () => {
    const refund = await process().execute(
      command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
    );

    await process().execute(
      command(WagerTransactionKind.BET, 'bet-1', '80.00'),
    );

    await tornarElegivel(refund.transactionId);

    await Promise.all([workerOn(orm).runOnce(), workerOn(second).runOnce()]);

    expect(await saldo()).toBe('100.00');
    expect(await lancamentos()).toBe(3);

    const creditos = await sql(`
        select id from wallet_ledger_entries
         where transaction_id = '${refund.transactionId}';
      `);

    expect(creditos).toHaveLength(1);
  });
});
