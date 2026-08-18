import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import config from '@/infrastructure/database/mikro-orm.config';

let orm: MikroORM;

const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const OTHER_WALLET_ID = '018f0e3a-0000-7000-8000-00000000000f';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const BET_ID = '018f0e3a-0000-7000-8000-000000000003';
const ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';

const sql = async (statement: string): Promise<unknown> =>
  orm.em.getConnection().execute(statement);

/** Mensagem do driver e da causa: o nome da constraint pode estar em qualquer uma. */
const describeFailure = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? error.cause.message : '';

  return `${error.message} ${cause}`;
};

const expectRejection = async (
  statement: string,
  expected: string,
): Promise<void> => {
  const failure = await sql(statement).then(
    () => null,
    (error: unknown) => error,
  );

  expect(failure).not.toBeNull();
  expect(describeFailure(failure)).toContain(expected);
};

const insertWallet = (overrides: Record<string, string> = {}): string => {
  const values: Record<string, string> = {
    id: `'${WALLET_ID}'`,
    player_id: `'${PLAYER_ID}'`,
    currency: `'BRL'`,
    balance_amount: `'100.00'`,
    version: '1',
    ...overrides,
  };

  return `insert into wallets (${Object.keys(values).join(', ')})
          values (${Object.values(values).join(', ')});`;
};

const insertTransaction = (overrides: Record<string, string> = {}): string => {
  const values: Record<string, string> = {
    id: `'${BET_ID}'`,
    provider_id: `'provider-a'`,
    external_transaction_id: `'transaction-1'`,
    idempotency_key: `'provider-a:transaction-1'`,
    payload_hash: `'hash-1'`,
    wallet_id: `'${WALLET_ID}'`,
    player_id: `'${PLAYER_ID}'`,
    round_id: `'round-1'`,
    game_id: `'fortune-chimp'`,
    kind: `'BET'`,
    amount: `'80.00'`,
    currency: `'BRL'`,
    reference_external_transaction_id: 'null',
    reference_transaction_id: 'null',
    status: `'PROCESSED'`,
    failure_code: 'null',
    processed_at: 'now()',
    ...overrides,
  };

  return `insert into wager_transactions (${Object.keys(values).join(', ')})
          values (${Object.values(values).join(', ')});`;
};

const insertLedgerEntry = (overrides: Record<string, string> = {}): string => {
  const values: Record<string, string> = {
    id: `'${ENTRY_ID}'`,
    wallet_id: `'${WALLET_ID}'`,
    transaction_id: `'${BET_ID}'`,
    direction: `'DEBIT'`,
    amount: `'80.00'`,
    currency: `'BRL'`,
    balance_before: `'100.00'`,
    balance_after: `'20.00'`,
    ...overrides,
  };

  return `insert into wallet_ledger_entries (${Object.keys(values).join(', ')})
          values (${Object.values(values).join(', ')});`;
};

/** Reversão de um BET, usada nos testes de dupla reversão. */
const insertReversal = (
  kind: 'REFUND' | 'ROLLBACK',
  id: string,
  externalId: string,
): string =>
  insertTransaction({
    id: `'${id}'`,
    external_transaction_id: `'${externalId}'`,
    idempotency_key: `'provider-a:${externalId}'`,
    kind: `'${kind}'`,
    reference_external_transaction_id: `'transaction-1'`,
    reference_transaction_id: `'${BET_ID}'`,
  });

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
      wallet_ledger_entries,
      wager_transactions,
      wallets,
      inbox_messages,
      outbox_messages
    cascade;
  `);
  await sql(insertWallet());
});

describe('schema — garantias no banco', () => {
  describe('wallets', () => {
    it('recusa segunda carteira para o mesmo jogador e moeda', async () => {
      await expectRejection(
        insertWallet({ id: `'${OTHER_WALLET_ID}'` }),
        'wallets_player_currency_uk',
      );
    });

    it('permite a mesma dupla em moedas diferentes', async () => {
      await sql(
        insertWallet({ id: `'${OTHER_WALLET_ID}'`, currency: `'USD'` }),
      );

      const rows = await sql(`select count(*)::text as total from wallets;`);

      expect(rows).toEqual([{ total: '2' }]);
    });

    it('recusa saldo negativo', async () => {
      await expectRejection(
        insertWallet({
          id: `'${OTHER_WALLET_ID}'`,
          player_id: `'${OTHER_WALLET_ID}'`,
          balance_amount: `'-0.01'`,
        }),
        'wallets_balance_non_negative',
      );
    });
  });

  describe('wager_transactions', () => {
    beforeEach(async () => {
      await sql(insertTransaction());
    });

    it('recusa reuso da chave de idempotência', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
        }),
        'wager_transactions_idempotency_key_uk',
      );
    });

    it('recusa o mesmo par provedor e transação externa', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          idempotency_key: `'outra-chave'`,
        }),
        'wager_transactions_provider_external_uk',
      );
    });

    it('recusa segunda reversão do mesmo tipo sobre a mesma referência', async () => {
      await sql(insertReversal('REFUND', OTHER_WALLET_ID, 'transaction-2'));

      await expectRejection(
        insertReversal('REFUND', ENTRY_ID, 'transaction-3'),
        'wager_transactions_reversal_uk',
      );
    });

    it('permite REFUND e ROLLBACK sobre a mesma referência', async () => {
      await sql(insertReversal('REFUND', OTHER_WALLET_ID, 'transaction-2'));
      await sql(insertReversal('ROLLBACK', ENTRY_ID, 'transaction-3'));

      const rows = await sql(`
        select count(*)::text as total
          from wager_transactions
         where reference_transaction_id = '${BET_ID}';
      `);

      expect(rows).toEqual([{ total: '2' }]);
    });

    it('recusa reversão sem referência', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          kind: `'REFUND'`,
        }),
        'wager_transactions_reference_required',
      );
    });

    it('recusa movimento simples com referência', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          reference_external_transaction_id: `'transaction-1'`,
        }),
        'wager_transactions_reference_required',
      );
    });

    it('recusa tipo desconhecido', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          kind: `'CASHBACK'`,
        }),
        'wager_transactions_kind_known',
      );
    });

    it('recusa valor não positivo', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          amount: `'0.00'`,
        }),
        'wager_transactions_amount_positive',
      );
    });

    it('recusa código de falha em transação processada', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          failure_code: `'INSUFFICIENT_FUNDS'`,
        }),
        'wager_transactions_failure_code_scope',
      );
    });

    it('recusa transação processada sem instante de processamento', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          processed_at: 'null',
        }),
        'wager_transactions_processed_at_scope',
      );
    });

    it('recusa transação pendente com instante de processamento', async () => {
      await expectRejection(
        insertTransaction({
          id: `'${OTHER_WALLET_ID}'`,
          external_transaction_id: `'transaction-2'`,
          idempotency_key: `'provider-a:transaction-2'`,
          status: `'PENDING'`,
        }),
        'wager_transactions_processed_at_scope',
      );
    });
  });

  describe('wallet_ledger_entries', () => {
    beforeEach(async () => {
      await sql(insertTransaction());
    });

    it('aceita lançamento cuja aritmética fecha', async () => {
      await sql(insertLedgerEntry());

      const rows = await sql(`
        select balance_after::text as saldo from wallet_ledger_entries;
      `);

      expect(rows).toEqual([{ saldo: '20.00' }]);
    });

    it('recusa débito cujo saldo resultante não fecha', async () => {
      await expectRejection(
        insertLedgerEntry({ balance_after: `'20.01'` }),
        'wallet_ledger_entries_balanced',
      );
    });

    it('recusa crédito lançado com aritmética de débito', async () => {
      await expectRejection(
        insertLedgerEntry({ direction: `'CREDIT'` }),
        'wallet_ledger_entries_balanced',
      );
    });

    it('recusa saldo resultante negativo', async () => {
      await expectRejection(
        insertLedgerEntry({
          amount: `'100.01'`,
          balance_after: `'-0.01'`,
        }),
        'wallet_ledger_entries_balances_non_negative',
      );
    });

    it('recusa dois lançamentos para a mesma transação e carteira', async () => {
      await sql(insertLedgerEntry());

      await expectRejection(
        insertLedgerEntry({ id: `'${OTHER_WALLET_ID}'` }),
        'wallet_ledger_entries_wallet_transaction_uk',
      );
    });

    it('é imutável: UPDATE é negado no nível de privilégio', async () => {
      await sql(insertLedgerEntry());

      await expectRejection(
        `update wallet_ledger_entries set amount = '1.00';`,
        'permission denied',
      );
    });

    it('é imutável: DELETE é negado no nível de privilégio', async () => {
      await sql(insertLedgerEntry());

      await expectRejection(
        `delete from wallet_ledger_entries;`,
        'permission denied',
      );
    });
  });

  describe('inbox_messages', () => {
    it('recusa a mesma mensagem para o mesmo consumidor', async () => {
      const insert = `
        insert into inbox_messages (consumer_name, message_id, payload_hash)
        values ('wager-consumer', 'msg-1', 'hash-1');
      `;

      await sql(insert);

      await expectRejection(insert, 'inbox_messages_pkey');
    });

    it('permite a mesma mensagem em consumidores distintos', async () => {
      await sql(`
        insert into inbox_messages (consumer_name, message_id, payload_hash)
        values ('wager-consumer', 'msg-1', 'hash-1'),
               ('audit-consumer', 'msg-1', 'hash-1');
      `);

      const rows = await sql(`
        select count(*)::text as total from inbox_messages;
      `);

      expect(rows).toEqual([{ total: '2' }]);
    });
  });

  describe('representação monetária', () => {
    it('nenhuma coluna do schema usa ponto flutuante', async () => {
      const rows = await sql(`
        select table_name, column_name, data_type
          from information_schema.columns
         where table_schema = 'public'
           and data_type in ('double precision', 'real');
      `);

      expect(rows).toEqual([]);
    });

    it('toda coluna monetária é numeric com escala 2', async () => {
      const rows = await sql(`
        select count(*)::text as total
          from information_schema.columns
         where table_schema = 'public'
           and (column_name like '%amount%' or column_name like 'balance%')
           and (data_type <> 'numeric' or numeric_scale <> 2);
      `);

      expect(rows).toEqual([{ total: '0' }]);
    });
  });
});
