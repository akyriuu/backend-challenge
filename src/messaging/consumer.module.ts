import { Module } from '@nestjs/common';
import { MessagingModule } from '@/infrastructure/messaging/messaging.module';
import { SqsConsumerWorker } from '@/infrastructure/messaging/sqs-consumer.worker';
import { WageringModule } from '@/wagering/wagering.module';

@Module({
  imports: [MessagingModule, WageringModule],
  providers: [SqsConsumerWorker],
})
export class ConsumerModule {}
