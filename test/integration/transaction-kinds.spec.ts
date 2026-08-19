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
import type {
  TransactionalContext,
  UnitOfWork,
} from '@/application/ports/unit-of-work';
import { Money } from '@/domain/money';
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from '@/domain/wager-transaction';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmOutboxStore } from '@/infrastructure/database/mikro-orm.outbox-store';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';

let orm: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);

const useCase = (unitOfWork?: UnitOfWork): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    unitOfWork ?? new MikroOrmUnitOfWork(orm.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );

/**
 * Envolve a unidade de trabalho real e faz a gravação do evento explodir depois
 * de transação, lançamento e saldo já terem sido escritos. É a única forma de
 * provar que a transação SQL existe: se as escritas fossem independentes, o que
 * veio antes sobreviveria.
 */
class OutboxFalhandoUnitOfWork implements UnitOfWork {
  constructor(private readonly inner: UnitOfWork) {}

  run<T>(work: (context: TransactionalContext) => Promise<T>): Promise<T> {
    return this.inner.run((context) =>
      work({
        ...context,
        outbox: {
          enqueue: () =>
            Promise.reject(new Error('falha simulada ao gravar no outbox')),
        },
      }),
    );
  }
}

const command = (
  kind: WagerTransactionKind,
  externalId: string,
  amount: string,
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

const saldo = async (): Promise<string> => {
  const [row] = await sql<{ balance: string }>(`
      select balance_amount::text as balance from wallets where id = '${WALLET_ID}';
    `);

  return row?.balance ?? '';
};

const contar = async (tabela: string, filtro = 'true'): Promise<number> => {
  const [row] = await sql<{ total: number }>(`
      select count(*)::int as total from ${tabela} where ${filtro};
    `);

  return row?.total ?? -1;
};

const assertConsistente = async (): Promise<void> => {
  const [row] = await sql<{ consistent: boolean }>(`
      select w.balance_amount = coalesce(sum(
        case when e.direction = 'DEBIT' then -e.amount else e.amount end
      ), 0) as consistent
        from wallets w
        left join wallet_ledger_entries e on e.wallet_id = w.id
       where w.id = '${WALLET_ID}'
       group by w.balance_amount;
    `);

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
  await seedWallet('100.00');
});

describe('tipos que não movem saldo', () => {
  it('LOSS é processado, não gera lançamento e não altera o saldo', async () => {
    const result = await useCase().execute(
      command(WagerTransactionKind.LOSS, 'loss-1', '30.00'),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.balance.toString()).toBe('100.00');
    expect(await saldo()).toBe('100.00');
    expect(await contar('wallet_ledger_entries')).toBe(1);

    const [wallet] = await sql<{ version: number }>(`
        select version from wallets where id = '${WALLET_ID}';
      `);

    /** A versão só muda quando o saldo muda: LOSS não a incrementa. */
    expect(wallet?.version).toBe(1);
    await assertConsistente();
  });

  it('LOSS publica WagerTransactionProcessed, mas não WalletBalanceChanged', async () => {
    await useCase().execute(
      command(WagerTransactionKind.LOSS, 'loss-1', '30.00'),
    );

    const eventos = await sql<{ event_type: string }>(`
        select event_type from outbox_messages order by occurred_at;
      `);

    expect(eventos.map((evento) => evento.event_type)).toEqual([
      'WagerTransactionProcessed',
    ]);
  });

  it('WIN credita e move a versão', async () => {
    const result = await useCase().execute(
      command(WagerTransactionKind.WIN, 'win-1', '25.00'),
    );

    expect(result.balance.toString()).toBe('125.00');
    expect(await contar('wallet_ledger_entries', `direction = 'CREDIT'`)).toBe(
      2,
    );
    await assertConsistente();
  });
});

describe('atomicidade', () => {
  it('falha no meio da transação não deixa nada persistido', async () => {
    const falhando = useCase(
      new OutboxFalhandoUnitOfWork(new MikroOrmUnitOfWork(orm.em.fork())),
    );

    const erro = await falhando
      .execute(command(WagerTransactionKind.BET, 'bet-1', '30.00'))
      .then(
        () => null,
        (rejection: unknown) => rejection,
      );

    expect(erro).toBeInstanceOf(Error);

    /** Nem transação, nem lançamento, nem saldo alterado, nem evento. */
    expect(await contar('wager_transactions', `kind = 'BET'`)).toBe(0);
    expect(await contar('wallet_ledger_entries', `direction = 'DEBIT'`)).toBe(
      0,
    );
    expect(await contar('outbox_messages')).toBe(0);
    expect(await saldo()).toBe('100.00');
    await assertConsistente();
  });

  it('depois da falha, a mesma chave pode ser reenviada e processa', async () => {
    const falhando = useCase(
      new OutboxFalhandoUnitOfWork(new MikroOrmUnitOfWork(orm.em.fork())),
    );

    await falhando
      .execute(command(WagerTransactionKind.BET, 'bet-1', '30.00'))
      .catch(() => undefined);

    const result = await useCase().execute(
      command(WagerTransactionKind.BET, 'bet-1', '30.00'),
    );

    expect(result.status).toBe(WagerTransactionStatus.PROCESSED);
    expect(result.idempotentReplay).toBe(false);
    expect(await saldo()).toBe('70.00');
    await assertConsistente();
  });
});

describe('recuperação após reinicialização', () => {
  it('o estado sobrevive ao reinício e o outbox pendente ainda publica', async () => {
    await useCase().execute(
      command(WagerTransactionKind.BET, 'bet-1', '40.00'),
    );

    expect(await saldo()).toBe('60.00');
    expect(await contar('outbox_messages', 'published_at is null')).toBe(2);

    /** Equivalente a matar o processo: todas as conexões caem sem aviso. */
    await orm.close(true);
    orm = await MikroORM.init(config);

    expect(await saldo()).toBe('60.00');
    expect(await contar('outbox_messages', 'published_at is null')).toBe(2);
    await assertConsistente();

    const entregues: string[] = [];
    const publicadas = await new MikroOrmOutboxStore(orm.em).drain(
      50,
      (message) => {
        entregues.push(message.id);

        return Promise.resolve();
      },
    );

    expect(publicadas).toBe(2);
    expect(await contar('outbox_messages', 'published_at is null')).toBe(0);
    await assertConsistente();
  });
});
