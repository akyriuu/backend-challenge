import { Injectable } from '@nestjs/common';
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@/config/env';
import type { HealthProbe } from '../health-probe';

@Injectable()
export class SqsProbe implements HealthProbe {
  readonly name = 'sqs';

  constructor(private readonly client: SQSClient) {}

  async check(): Promise<void> {
    await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: env.sqs.queueUrl,
        AttributeNames: ['QueueArn'],
      }),
    );
  }
}
