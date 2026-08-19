import { Module } from '@nestjs/common';
import { MESSAGE_PUBLISHER, OUTBOX_STORE } from '@/application/ports/outbox';
import { MetricsController } from '@/api/metrics.controller';
import { MikroOrmOutboxStore } from '@/infrastructure/database/mikro-orm.outbox-store';
import { MessagingModule } from '@/infrastructure/messaging/messaging.module';
import { OutboxPublisherWorker } from '@/infrastructure/messaging/outbox-publisher.worker';
import { SqsMessagePublisher } from '@/infrastructure/messaging/sqs.publisher';

@Module({
  imports: [MessagingModule],
  controllers: [MetricsController],
  providers: [
    OutboxPublisherWorker,
    { provide: OUTBOX_STORE, useClass: MikroOrmOutboxStore },
    { provide: MESSAGE_PUBLISHER, useClass: SqsMessagePublisher },
  ],
})
export class OutboxModule {}
