import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { defineEntity, p, t, type InferEntity } from '@mikro-orm/core';
import { LockMode, MikroORM } from '@mikro-orm/postgresql';
import Decimal from 'decimal.js';
import { env } from '@/config/env';

const DB_URL = env.databaseUrl;

// ---------- domínio (puro, sem nenhum import do ORM) ----------

class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: { amount: string; currency: string }): Money {
    if (!/^\d+(\.\d{1,2})?$/.test(props.amount)) {
      throw new Error(`valor monetário inválido: ${props.amount}`);
    }
    return new Money(new Decimal(props.amount), props.currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  toString(): string {
    return this.value.toFixed(2);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(
        `moedas incompatíveis: ${this.currency} e ${other.currency}`,
      );
    }
  }
}

class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    private _balance: Money,
    private _version: number,
  ) {}

  static open(props: {
    id: string;
    playerId: string;
    initialBalance: Money;
  }): Wallet {
    return new Wallet(props.id, props.playerId, props.initialBalance, 1);
  }

  static rehydrate(state: {
    id: string;
    playerId: string;
    balance: Money;
    version: number;
  }): Wallet {
    return new Wallet(state.id, state.playerId, state.balance, state.version);
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  debit(amount: Money): void {
    const next = this._balance.subtract(amount);

    if (next.isNegative()) {
      throw new Error('saldo insuficiente');
    }

    this._balance = next;
    this._version += 1;
  }
}

// ---------- persistência ----------

const WalletSchema = defineEntity({
  name: 'Wallet',
  tableName: 'spike_wallets',
  properties: {
    id: p.uuid().primary(),
    playerId: p.string(),
    currency: p.string(),
    balanceAmount: p.type(t.decimal).$type<string>(),
    version: p.integer(),
  },
});

type WalletRecord = InferEntity<typeof WalletSchema>;

const toDomain = (record: WalletRecord): Wallet =>
  Wallet.rehydrate({
    id: record.id,
    playerId: record.playerId,
    balance: Money.from({
      amount: record.balanceAmount,
      currency: record.currency,
    }),
    version: record.version,
  });

// ---------- spike ----------

let orm: MikroORM;
const queries: string[] = [];

beforeAll(async () => {
  orm = await MikroORM.init({
    clientUrl: DB_URL,
    entities: [WalletSchema],
    allowGlobalContext: true,
    debug: ['query'],
    logger: (message) => queries.push(message),
  });

  await orm.em.getConnection().execute(`
    drop table if exists spike_wallets;
    create table spike_wallets (
      id uuid primary key,
      player_id text not null,
      currency char(3) not null,
      balance_amount numeric(20,2) not null,
      version integer not null,
      constraint wallets_balance_non_negative check (balance_amount >= 0)
    );
  `);
});

afterAll(async () => {
  await orm.close(true);
});

describe('MikroORM v7 sobre Bun', () => {
  it('reidrata o agregado sem perder precisão decimal', async () => {
    const em = orm.em.fork();
    const id = crypto.randomUUID();

    em.create(WalletSchema, {
      id,
      playerId: 'player-1',
      currency: 'BRL',
      balanceAmount: '1000.00',
      version: 1,
    });
    await em.flush();
    em.clear();

    const record = await em.findOneOrFail(WalletSchema, id);

    expect(typeof record.balanceAmount).toBe('string');
    expect(record.balanceAmount).toBe('1000.00');

    const wallet = toDomain(record);

    expect(wallet).toBeInstanceOf(Wallet);
    expect(wallet.balance.toString()).toBe('1000.00');
    expect(wallet.version).toBe(1);
  });

  it('a coluna é numeric com escala 2, não ponto flutuante', async () => {
    const rows = await orm.em.getConnection().execute<
      Array<{ data_type: string; numeric_scale: number }>
    >(`select data_type, numeric_scale
         from information_schema.columns
        where table_name = 'spike_wallets' and column_name = 'balance_amount'`);

    expect(rows[0]?.data_type).toBe('numeric');
    expect(rows[0]?.numeric_scale).toBe(2);
  });

  it('a aritmética do domínio sobrevive ao round-trip', async () => {
    const em = orm.em.fork();
    const id = crypto.randomUUID();

    em.create(WalletSchema, {
      id,
      playerId: 'player-2',
      currency: 'BRL',
      balanceAmount: '0.10',
      version: 1,
    });
    await em.flush();
    em.clear();

    const wallet = toDomain(await em.findOneOrFail(WalletSchema, id));
    const somado = wallet.balance.add(
      Money.from({ amount: '0.20', currency: 'BRL' }),
    );

    const record = await em.findOneOrFail(WalletSchema, id);
    record.balanceAmount = somado.toString();
    await em.flush();
    em.clear();

    const relido = await em.findOneOrFail(WalletSchema, id);

    expect(relido.balanceAmount).toBe('0.30');
  });

  it('emite SELECT ... FOR UPDATE com lock pessimista', async () => {
    const em = orm.em.fork();
    const id = crypto.randomUUID();

    em.create(WalletSchema, {
      id,
      playerId: 'player-3',
      currency: 'BRL',
      balanceAmount: '50.00',
      version: 1,
    });
    await em.flush();

    queries.length = 0;

    await em.transactional(async (tx) => {
      await tx.findOneOrFail(WalletSchema, id, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
    });

    expect(queries.some((query) => query.includes('for update'))).toBe(true);
  });
});
