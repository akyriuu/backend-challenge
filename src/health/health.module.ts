import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { env } from '@/config/env';
import { HealthController } from './health.controller';
import { HEALTH_PROBES } from './health-probe';
import { PostgresProbe } from './probes/postgres.probe';
import { SqsProbe } from './probes/sqs.probe';

@Module({
  controllers: [HealthController],
  providers: [
    PostgresProbe,
    SqsProbe,
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
    {
      provide: HEALTH_PROBES,
      useFactory: (postgresProbe: PostgresProbe, sqsProbe: SqsProbe) => [
        postgresProbe,
        sqsProbe,
      ],
      inject: [PostgresProbe, SqsProbe],
    },
  ],
  exports: [SQSClient],
})
export class HealthModule {}
