import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import { ProcessWagerTransaction } from '@/application/process-wager-transaction-use-case';
import { Money } from '@/domain/money';
import { WagerTransactionKind } from '@/domain/wager-transaction';
import { env } from '@/config/env';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmUnitOfWork } from '@/infrastructure/database/mikro-orm.unit-of-work';
import { SqsConsumerWorker } from '@/infrastructure/messaging/sqs-consumer.worker';
let orm: MikroORM;
let sqsClient: SQSClient;
let worker: SqsConsumerWorker;
const WALLET_ID = '018f0e3a-0000-7000-8000-000000000001';
const PLAYER_ID = '018f0e3a-0000-7000-8000-000000000002';
const OPENING_TX_ID = '018f0e3a-0000-7000-8000-000000000003';
const OPENING_ENTRY_ID = '018f0e3a-0000-7000-8000-000000000004';
const sql = async <T>(statement: string): Promise<T[]> =>
  orm.em.getConnection().execute<T[]>(statement);
const useCase = (): ProcessWagerTransaction =>
  new ProcessWagerTransaction(
    new MikroOrmUnitOfWork(orm.em.fork()),
    { next: () => Bun.randomUUIDv7() },
    { now: () => new Date() },
  );
const message = (
  messageId: string,
  amount: string,
  kind: WagerTransactionKind = WagerTransactionKind.BET,
): string =>
  JSON.stringify({
    messageId,
    type: 'WagerTransactionRequested',
    occurredAt: new Date().toISOString(),
    data: {
      providerId: 'provider-a',
      externalTransactionId: messageId,
      idempotencyKey: `provider-a:${messageId}`,
      playerId: PLAYER_ID,
      walletId: WALLET_ID,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind,
      money: { amount, currency: 'BRL' },
    },
  });
const enfileirar = async (body: string): Promise<void> => {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: env.sqs.queueUrl,
      MessageBody: body,
      MessageGroupId: WALLET_ID,
      MessageDeduplicationId: Bun.randomUUIDv7(),
    }),
  );
};
/** Esvazia a fila recebendo e apagando, já que purge-queue é limitado a 1/min. */
const esvaziar = async (queueUrl: string): Promise<void> => {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    if (!response.Messages?.length) {
      return;
    }
    for (const recebida of response.Messages) {
      await sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: recebida.ReceiptHandle ?? '',
        }),
      );
    }
  }
};
/** Recebe e apaga, para não deixar mensagens em voo entre testes. */
const receberDaDlq = async (): Promise<number> => {
  const response = await sqsClient.send(
    new ReceiveMessageCommand({
      QueueUrl: env.sqs.dlqUrl,
      MaxNumberOfMessages: 10,
      WaitTimeSeconds: 2,
    }),
  );
  const mensagens = response.Messages ?? [];
  for (const recebida of mensagens) {
    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: env.sqs.dlqUrl,
        ReceiptHandle: recebida.ReceiptHandle ?? '',
      }),
    );
  }
  return mensagens.length;
};
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
const debitos = async (): Promise<number> => {
  const rows = await sql(`
      select id from wallet_ledger_entries
       where wallet_id = '${WALLET_ID}' and direction = 'DEBIT';
    `);
  return rows.length;
};
beforeAll(async () => {
  orm = await MikroORM.init(config);
  await orm.migrator.up();
  sqsClient = new SQSClient({
    region: env.sqs.region,
    endpoint: env.sqs.endpoint,
    credentials:
      env.sqs.accessKeyId && env.sqs.secretAccessKey
        ? {
            accessKeyId: env.sqs.accessKeyId,
            secretAccessKey: env.sqs.secretAccessKey,
          }
        : undefined,
  });
  worker = new SqsConsumerWorker(sqsClient, useCase());
});
afterAll(async () => {
  await orm.close(true);
  sqsClient.destroy();
});
beforeEach(async () => {
  await sql(`
      truncate table
        wallet_ledger_entries, wager_transactions, wallets,
        inbox_messages, outbox_messages
      cascade;
    `);
  await seedWallet('100.00');
  await esvaziar(env.sqs.queueUrl);
  await esvaziar(env.sqs.dlqUrl);
});
describe('consumidor SQS', () => {
  it('aplica a transação vinda da fila e registra o inbox', async () => {
    await enfileirar(message('msg-1', '80.00'));
    await worker.pollOnce();
    expect(await saldo()).toBe('20.00');
    expect(await debitos()).toBe(1);
    const [inbox] = await sql<{ consumer_name: string; processado: boolean }>(`
        select consumer_name, processed_at is not null as processado
          from inbox_messages where message_id = 'msg-1';
      `);
    expect(inbox?.consumer_name).toBe(env.consumer.name);
    expect(inbox?.processado).toBe(true);
  });
  it('reentrega da mesma mensagem não duplica o débito', async () => {
    const corpo = message('msg-1', '80.00');
    await enfileirar(corpo);
    await worker.pollOnce();
    /** Mesma mensagem, dedup do broker contornado: simula reentrega at-least-once. */
    await enfileirar(corpo);
    await worker.pollOnce();
    expect(await saldo()).toBe('20.00');
    expect(await debitos()).toBe(1);
    const inbox = await sql(`select message_id from inbox_messages;`);
    expect(inbox).toHaveLength(1);
  });
  it('mensagem processada antes do ack é reprocessada sem efeito duplicado', async () => {
    /** Simula morrer depois do commit e antes do ack: o efeito já existe na base. */
    await useCase().execute({
      providerId: 'provider-a',
      externalTransactionId: 'msg-1',
      idempotencyKey: 'provider-a:msg-1',
      payloadHash: 'irrelevante',
      walletId: WALLET_ID,
      playerId: PLAYER_ID,
      roundId: 'round-1',
      gameId: 'fortune-chimp',
      kind: WagerTransactionKind.BET,
      money: Money.from({ amount: '80.00', currency: 'BRL' }),
      correlationId: 'correlation-1',
    });
    expect(await saldo()).toBe('20.00');
    await enfileirar(message('msg-1', '80.00'));
    await worker.pollOnce();
    expect(await saldo()).toBe('20.00');
    expect(await debitos()).toBe(1);
  });
  it('rejeição de negócio confirma a mensagem e fica auditável', async () => {
    await enfileirar(message('msg-1', '500.00'));
    await worker.pollOnce();
    expect(await saldo()).toBe('100.00');
    expect(await debitos()).toBe(0);
    const [transacao] = await sql<{ status: string; failure_code: string }>(`
        select status, failure_code from wager_transactions
         where external_transaction_id = 'msg-1';
      `);
    expect(transacao?.status).toBe('REJECTED');
    expect(transacao?.failure_code).toBe('INSUFFICIENT_FUNDS');
  });
  it('payload inválido vai direto para a DLQ, sem retentativa', async () => {
    await enfileirar('{"messageId":"msg-1","type":"x","occurredAt":"agora"}');
    await worker.pollOnce();
    expect(await receberDaDlq()).toBe(1);
    expect(await debitos()).toBe(0);
  });
  it('valor com precisão inválida é permanente, não transitório', async () => {
    await enfileirar(message('msg-1', '80.005'));
    await worker.pollOnce();
    expect(await receberDaDlq()).toBe(1);
    expect(await saldo()).toBe('100.00');
  });
});
