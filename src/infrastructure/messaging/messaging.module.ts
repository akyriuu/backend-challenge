import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@/config/env';

@Module({
  providers: [
    {
      provide: SQSClient,
      useFactory: () =>
        new SQSClient({
          region: env.sqs.region,
          endpoint: env.sqs.endpoint,
          credentials:
            env.sqs.accessKeyId && env.sqs.secretAccessKey
              ? {
                  accessKeyId: env.sqs.accessKeyId,
                  secretAccessKey: env.sqs.secretAccessKey,
                }
              : undefined,
        }),
    },
  ],
  exports: [SQSClient],
})
export class MessagingModule {}
