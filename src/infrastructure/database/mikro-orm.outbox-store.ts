import { Injectable, Logger } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import type { OutboxStore, PendingMessage } from '@/application/ports/outbox';
import { OutboxMessageSchema } from './schemas/outbox-message.schema';

const MAX_BACKOFF_SECONDS = 300;

/** Backoff exponencial com teto: 2s, 4s, 8s... até cinco minutos. */
const nextAttemptAfter = (attempts: number, now: Date): Date => {
  const seconds = Math.min(2 ** attempts, MAX_BACKOFF_SECONDS);

  return new Date(now.getTime() + seconds * 1000);
};

@Injectable()
export class MikroOrmOutboxStore implements OutboxStore {
  private readonly logger = new Logger(MikroOrmOutboxStore.name);

  constructor(private readonly em: EntityManager) {}

  async drain(
    batchSize: number,
    handler: (message: PendingMessage) => Promise<void>,
  ): Promise<number> {
    return this.em.fork().transactional(async (tx) => {
      const now = new Date();

      const records = await tx.find(
        OutboxMessageSchema,
        {
          publishedAt: null,
          $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
        },
        {
          limit: batchSize,
          orderBy: { occurredAt: 'asc' },
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );

      let published = 0;

      for (const record of records) {
        try {
          await handler({
            id: record.id,
            aggregateId: record.aggregateId,
            eventType: record.eventType,
            payload: record.payload,
            occurredAt: record.occurredAt,
            attempts: record.attempts,
          });

          record.publishedAt = new Date();
          published += 1;
        } catch (error) {
          record.attempts += 1;
          record.nextAttemptAt = nextAttemptAfter(record.attempts, now);

          this.logger.warn({
            message: 'falha ao publicar evento do outbox',
            eventId: record.id,
            eventType: record.eventType,
            attempts: record.attempts,
            nextAttemptAt: record.nextAttemptAt.toISOString(),
            reason: error instanceof Error ? error.message : 'desconhecido',
          });
        }
      }

      await tx.flush();

      return published;
    });
  }
}
