import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import {
  ReceiveMessageCommand,
  SQSClient,
  type Message,
} from '@aws-sdk/client-sqs';
import { MikroORM } from '@mikro-orm/postgresql';
import type { PendingMessage } from '@/application/ports/outbox';
import { env } from '@/config/env';
import config from '@/infrastructure/database/mikro-orm.config';
import { MikroOrmOutboxStore } from '@/infrastructure/database/mikro-orm.outbox-store';
import { SqsMessagePublisher } from '@/infrastructure/messaging/sqs.publisher';
const PUBLISHERS = 2;
const BATCH = 50;
let admin: MikroORM;
let instances: MikroORM[] = [];
let sqsClient: SQSClient;
const sql = async <T>(statement: string): Promise<T[]> =>
  admin.em.getConnection().execute<T[]>(statement);
const seedEvents = async (total: number): Promise<string[]> => {
  const ids = Array.from({ length: total }, () => Bun.randomUUIDv7());
  for (const [index, id] of ids.entries()) {
    await sql(`
        insert into outbox_messages (
          id, aggregate_id, event_type, payload, occurred_at, attempts
        ) values (
          '${id}', '${Bun.randomUUIDv7()}', 'WalletBalanceChanged',
          '{"eventId":"${id}","eventType":"WalletBalanceChanged"}'::jsonb,
          now() + interval '${index} milliseconds', 0
        );
      `);
  }
  return ids;
};
const publishedIds = async (): Promise<string[]> => {
  const rows = await sql<{ id: string }>(`
      select id from outbox_messages where published_at is not null;
    `);
  return rows.map((row) => row.id);
};
/** Percorre a fila até achar a mensagem esperada, tolerando resíduos. */
async function receberAte(eventId: string): Promise<Message | undefined> {
  for (let tentativa = 0; tentativa < 5; tentativa += 1) {
    const response = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: env.sqs.eventsQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    const encontrada = response.Messages?.find((message) =>
      message.Body?.includes(eventId),
    );
    if (encontrada) {
      return encontrada;
    }
  }
  return undefined;
}
beforeAll(async () => {
  admin = await MikroORM.init(config);
  await admin.migrator.up();
  instances = await Promise.all(
    Array.from({ length: PUBLISHERS }, () => MikroORM.init(config)),
  );
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
});
afterAll(async () => {
  await Promise.all(instances.map((instance) => instance.close(true)));
  await admin.close(true);
  sqsClient.destroy();
});
beforeEach(async () => {
  await sql(`truncate table outbox_messages;`);
});
describe('outbox', () => {
  it('publica o que está pendente e marca o instante da publicação', async () => {
    const ids = await seedEvents(3);
    const entregues: string[] = [];
    const store = new MikroOrmOutboxStore(admin.em);
    const total = await store.drain(BATCH, (message: PendingMessage) => {
      entregues.push(message.id);
      return Promise.resolve();
    });
    expect(total).toBe(3);
    expect(entregues.sort()).toEqual([...ids].sort());
    expect((await publishedIds()).sort()).toEqual([...ids].sort());
  });
  it('dois publishers concorrentes não entregam a mesma mensagem duas vezes', async () => {
    const ids = await seedEvents(40);
    const entregues = new Map<number, string[]>();
    const drains = instances.map((instance, index) => {
      entregues.set(index, []);
      return new MikroOrmOutboxStore(instance.em).drain(
        BATCH,
        async (message: PendingMessage) => {
          entregues.get(index)?.push(message.id);
          /** Alarga a janela para que os dois lotes de fato se sobreponham. */
          await new Promise((resolve) => setTimeout(resolve, 5));
        },
      );
    });
    const totais = await Promise.all(drains);
    const todos = [...entregues.values()].flat();
    expect(totais.reduce((soma, total) => soma + total, 0)).toBe(ids.length);
    expect(new Set(todos).size).toBe(todos.length);
    expect(todos.sort()).toEqual([...ids].sort());
    expect((await publishedIds()).sort()).toEqual([...ids].sort());
  });
  it('falha de publicação agenda nova tentativa em vez de marcar publicada', async () => {
    await seedEvents(1);
    const store = new MikroOrmOutboxStore(admin.em);
    const total = await store.drain(BATCH, () =>
      Promise.reject(new Error('SQS indisponível')),
    );
    expect(total).toBe(0);
    const [row] = await sql<{
      attempts: number;
      publicado: boolean;
      agendado: boolean;
    }>(`
        select attempts,
               published_at is not null as publicado,
               next_attempt_at > now() as agendado
          from outbox_messages;
      `);
    expect(row?.attempts).toBe(1);
    expect(row?.publicado).toBe(false);
    expect(row?.agendado).toBe(true);
  });
  it('não reclama mensagem cuja próxima tentativa está no futuro', async () => {
    await seedEvents(1);
    await sql(`
        update outbox_messages
           set attempts = 3, next_attempt_at = now() + interval '5 minutes';
      `);
    const store = new MikroOrmOutboxStore(admin.em);
    const total = await store.drain(BATCH, () => Promise.resolve());
    expect(total).toBe(0);
  });
  it('não republica o que já foi publicado', async () => {
    await seedEvents(2);
    const store = new MikroOrmOutboxStore(admin.em);
    await store.drain(BATCH, () => Promise.resolve());
    const segunda = await store.drain(BATCH, () => Promise.resolve());
    expect(segunda).toBe(0);
  });
  it('entrega de verdade na fila do SQS', async () => {
    const [id] = await seedEvents(1);
    if (!id) {
      throw new Error('semeadura do outbox falhou');
    }
    const publisher = new SqsMessagePublisher(sqsClient);
    const store = new MikroOrmOutboxStore(admin.em);
    await store.drain(BATCH, (message) => publisher.publish(message));
    const recebida = await receberAte(id);
    expect(recebida).toBeDefined();
    expect(recebida?.Body).toContain(id);
  });
});
