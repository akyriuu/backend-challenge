import { describe, expect, it } from 'bun:test';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { HealthProbe } from './health-probe';

const probe = (name: string, behaviour: 'up' | 'down'): HealthProbe => ({
  name,
  check: () =>
    behaviour === 'up'
      ? Promise.resolve()
      : Promise.reject(new Error('conexão recusada')),
});

describe('HealthController', () => {
  it('live responde ok mesmo com dependência fora', () => {
    const controller = new HealthController([probe('postgres', 'down')]);

    expect(controller.live().status).toBe('ok');
  });

  it('ready responde ok quando todas as sondas sobem', async () => {
    const controller = new HealthController([
      probe('postgres', 'up'),
      probe('sqs', 'up'),
    ]);

    const body = await controller.ready();

    expect(body.status).toBe('ok');
    expect(body.checks.map((check) => check.status)).toEqual(['up', 'up']);
  });

  it('ready responde 503 identificando a sonda que caiu', async () => {
    const controller = new HealthController([
      probe('postgres', 'down'),
      probe('sqs', 'up'),
    ]);

    const error = await controller.ready().then(
      () => null,
      (rejection: unknown) => rejection,
    );

    expect(error).toBeInstanceOf(ServiceUnavailableException);

    const failure = error as ServiceUnavailableException;
    const body = failure.getResponse() as {
      checks: { name: string; status: string }[];
    };

    expect(failure.getStatus()).toBe(503);
    expect(body.checks.find((check) => check.name === 'postgres')?.status).toBe(
      'down',
    );
    expect(body.checks.find((check) => check.name === 'sqs')?.status).toBe(
      'up',
    );
  });
});
