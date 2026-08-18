import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  MESSAGE_PUBLISHER,
  OUTBOX_STORE,
  type MessagePublisher,
  type OutboxStore,
} from '@/application/ports/outbox';
import { env } from '@/config/env';

@Injectable()
export class OutboxPublisherWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(OutboxPublisherWorker.name);
  private stopping = false;
  private cycle: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    @Inject(OUTBOX_STORE) private readonly store: OutboxStore,
    @Inject(MESSAGE_PUBLISHER) private readonly publisher: MessagePublisher,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule();
  }

  /** Conclui o ciclo em andamento antes de deixar o processo morrer. */
  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;

    if (this.timer) {
      clearTimeout(this.timer);
    }

    await this.cycle;
  }

  private schedule(): void {
    if (this.stopping) {
      return;
    }

    this.timer = setTimeout(() => {
      this.cycle = this.runOnce().finally(() => this.schedule());
    }, env.outbox.pollIntervalMs);
  }

  private async runOnce(): Promise<void> {
    try {
      const published = await this.store.drain(
        env.outbox.batchSize,
        (message) => this.publisher.publish(message),
      );

      if (published > 0) {
        this.logger.log({ message: 'eventos publicados', published });
      }
    } catch (error) {
      this.logger.error({
        message: 'ciclo do publisher falhou',
        reason: error instanceof Error ? error.message : 'desconhecido',
      });
    }
  }
}
