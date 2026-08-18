import 'reflect-metadata';
import { describe, expect, it } from 'bun:test';
import { SQSClient } from '@aws-sdk/client-sqs';
import { EntityManager } from '@mikro-orm/postgresql';
import { PostgresProbe } from '../src/health/probes/postgres.probe';
import { SqsProbe } from '../src/health/probes/sqs.probe';

describe('toolchain', () => {
  it('preserva design:paramtypes das dependências de classe sob o Bun', () => {
    const postgresParams = Reflect.getMetadata(
      'design:paramtypes',
      PostgresProbe,
    ) as unknown[];
    const sqsParams = Reflect.getMetadata(
      'design:paramtypes',
      SqsProbe,
    ) as unknown[];

    expect(postgresParams).toHaveLength(1);
    expect(postgresParams[0]).toBe(EntityManager);

    expect(sqsParams).toHaveLength(1);
    expect(sqsParams[0]).toBe(SQSClient);
  });
});
