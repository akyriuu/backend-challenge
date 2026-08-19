import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ResolvePendingReference } from '@/application/resolve-pending-reference.use-case';
import {
  PENDING_REFERENCE_STORE,
  type PendingReferenceStore,
} from '@/application/ports/pending-reference';
import { env } from '@/config/env';

@Injectable()
export class PendingReferenceWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private stopping = false;
  private cycle: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    @Inject(PENDING_REFERENCE_STORE)
    private readonly store: PendingReferenceStore,
    private readonly resolve: ResolvePendingReference,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.cycle;
  }

  async runOnce(): Promise<void> {
    try {
      const due = await this.store.due(env.pendingReference.batchSize);

      for (const transactionId of due) {
        await this.resolve.execute(transactionId);
      }

      const exhausted = await this.store.exhausted(
        env.pendingReference.batchSize,
      );

      for (const transactionId of exhausted) {
        await this.resolve.expire(transactionId);
      }

      if (due.length > 0 || exhausted.length > 0) {
        this.logger.log({
          message: 'reversões pendentes revisitadas',
          reprocessadas: due.length,
          descartadas: exhausted.length,
        });
      }
    } catch (error) {
      this.logger.error({
        message: 'ciclo de referências pendentes falhou',
        reason: error instanceof Error ? error.message : 'desconhecido',
      });
    }
  }

  private schedule(): void {
    if (this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      this.cycle = this.runOnce().finally(() => this.schedule());
    }, env.pendingReference.pollIntervalMs);
  }
}
