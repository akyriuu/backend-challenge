import { Injectable } from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type {
  MessagePublisher,
  PendingMessage,
} from '@/application/ports/outbox';
import { env } from '@/config/env';

@Injectable()
export class SqsMessagePublisher implements MessagePublisher {
  constructor(private readonly client: SQSClient) {}

  async publish(message: PendingMessage): Promise<void> {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: env.sqs.eventsQueueUrl,
        MessageBody: JSON.stringify(message.payload),
        MessageGroupId: message.aggregateId,
        MessageDeduplicationId: message.id,
      }),
    );
  }
}
