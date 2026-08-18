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
import { FailureCode } from '@/domain/failure-code';
import { Money } from '@/domain/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';

let orm: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const brl = (amount: string): Money => Money.from({ amount, currency: 'BRL' });

const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);

const useCase = (): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(orm.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
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
  money: brl(amount),
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

const assertWalletConsistent = async (): Promise<void> => {
  const [row] = await sql<{ stored: string; consistent: boolean }>(`
      select
        w.balance_amount::text as stored,
        w.balance_amount = coalesce(sum(
          case when e.direction = 'DEBIT' then -e.amount else e.amount end
        ), 0) as consistent
        from wallets w
        left join wallet_ledger_entries e on e.wallet_id = w.id
       where w.id = '${WALLET_ID}'
       group by w.balance_amount;
    `);

  expect(row?.consistent).toBe(true);
};

const balanceOf = async (): Promise<string> => {
  const [row] = await sql<{ balance: string }>(`
      select balance_amount::text as balance from wallets where id = '${WALLET_ID}';
    `);

  return row?.balance ?? '';
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

describe('reversões', () => {
  describe('REFUND', () => {
    it('credita de volta uma aposta processada', async () => {
      await useCase().execute(
        command(WagerTransactionKind.BET, 'bet-1', '80.00'),
      );

      const refund = await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
      );

      expect(refund.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(refund.balance.toString()).toBe('100.00');
      expect(await balanceOf()).toBe('100.00');

      const [persistida] = await sql<{ reference_transaction_id: string }>(`
          select reference_transaction_id from wager_transactions
           where external_transaction_id = 'refund-1';
        `);

      expect(persistida?.reference_transaction_id).not.toBeNull();
      await assertWalletConsistent();
    });

    it('aguarda quando a referência ainda não chegou', async () => {
      const refund = await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
      );

      expect(refund.status).toBe(WagerTransactionStatus.PENDING_REFERENCE);
      expect(refund.failureCode).toBeUndefined();
      expect(await balanceOf()).toBe('100.00');

      const lancamentos = await sql(`
          select id from wallet_ledger_entries
           where transaction_id = '${refund.transactionId}';
        `);

      expect(lancamentos).toHaveLength(0);

      const eventos = await sql<{ event_type: string }>(`
          select event_type from outbox_messages
           where event_type = 'WagerTransactionPendingReference';
        `);

      expect(eventos).toHaveLength(1);
      await assertWalletConsistent();
    });

    it('recusa a segunda reversão do mesmo tipo sobre a mesma referência', async () => {
      await useCase().execute(
        command(WagerTransactionKind.BET, 'bet-1', '80.00'),
      );
      await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
      );

      const segunda = await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-2', '80.00', 'bet-1'),
      );

      expect(segunda.status).toBe(WagerTransactionStatus.REJECTED);
      expect(segunda.failureCode).toBe(FailureCode.REFERENCE_ALREADY_REVERSED);
      expect(await balanceOf()).toBe('100.00');
      await assertWalletConsistent();
    });

    it('recusa referenciar algo que não é aposta', async () => {
      await useCase().execute(
        command(WagerTransactionKind.WIN, 'win-1', '50.00'),
      );

      const refund = await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '50.00', 'win-1'),
      );

      expect(refund.failureCode).toBe(FailureCode.REFERENCE_NOT_REVERSIBLE);
      await assertWalletConsistent();
    });

    it('exige reversão integral', async () => {
      await useCase().execute(
        command(WagerTransactionKind.BET, 'bet-1', '80.00'),
      );

      const parcial = await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '40.00', 'bet-1'),
      );

      expect(parcial.failureCode).toBe(FailureCode.AMOUNT_MISMATCH);
      expect(await balanceOf()).toBe('20.00');
      await assertWalletConsistent();
    });
  });

  describe('ROLLBACK', () => {
    it('inverte a direção da referência: desfazendo um prêmio, debita', async () => {
      await useCase().execute(
        command(WagerTransactionKind.WIN, 'win-1', '50.00'),
      );

      const rollback = await useCase().execute(
        command(WagerTransactionKind.ROLLBACK, 'rollback-1', '50.00', 'win-1'),
      );

      expect(rollback.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(rollback.balance.toString()).toBe('100.00');

      const [lancamento] = await sql<{ direction: string }>(`
          select direction from wallet_ledger_entries
           where transaction_id = '${rollback.transactionId}';
        `);

      expect(lancamento?.direction).toBe('DEBIT');
      await assertWalletConsistent();
    });

    it('desfazendo um estorno, credita de volta ao estado anterior', async () => {
      await useCase().execute(
        command(WagerTransactionKind.BET, 'bet-1', '80.00'),
      );
      await useCase().execute(
        command(WagerTransactionKind.REFUND, 'refund-1', '80.00', 'bet-1'),
      );

      const rollback = await useCase().execute(
        command(
          WagerTransactionKind.ROLLBACK,
          'rollback-1',
          '80.00',
          'refund-1',
        ),
      );

      expect(rollback.status).toBe(WagerTransactionStatus.PROCESSED);
      expect(await balanceOf()).toBe('20.00');
      await assertWalletConsistent();
    });

    it('recusa reversão que deixaria a carteira negativa', async () => {
      await useCase().execute(
        command(WagerTransactionKind.WIN, 'win-1', '50.00'),
      );
      await useCase().execute(
        command(WagerTransactionKind.BET, 'bet-1', '140.00'),
      );

      const rollback = await useCase().execute(
        command(WagerTransactionKind.ROLLBACK, 'rollback-1', '50.00', 'win-1'),
      );

      expect(rollback.status).toBe(WagerTransactionStatus.REJECTED);
      expect(rollback.failureCode).toBe(FailureCode.REVERSAL_WOULD_OVERDRAW);
      expect(await balanceOf()).toBe('10.00');
      await assertWalletConsistent();
    });
  });
});
