import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import {
  METRICS,
  noopMetrics,
  type Metrics,
} from '@/application/ports/metrics';
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

  constructor(
    private readonly em: EntityManager,
    @Optional()
    @Inject(METRICS)
    private readonly metrics: Metrics = noopMetrics,
  ) {}

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
          lockMode: LockMode.PESSIMISTIC_PARTIAL_WRITE,
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

          this.metrics.increment('wager_outbox_published_total', {
            eventType: record.eventType,
          });
        } catch (error) {
          record.attempts += 1;
          record.nextAttemptAt = nextAttemptAfter(record.attempts, now);

          this.metrics.increment('wager_outbox_retries_total', {
            eventType: record.eventType,
          });

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

  async oldestPendingAgeSeconds(): Promise<number> {
    const rows = await this.em.getConnection().execute<{ lag: number }[]>(
      `select coalesce(
                extract(epoch from now() - min(occurred_at))::int, 0
              ) as lag
         from outbox_messages
        where published_at is null`,
    );

    return rows[0]?.lag ?? 0;
  }
}
