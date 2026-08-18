import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@/app.module';

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app.close();
});

describe('health (integração)', () => {
  it('live responde 200', async () => {
    const response = await fetch(new URL('/health/live', baseUrl));

    expect(response.status).toBe(200);
  });

  it('ready responde 200 com postgres e sqs alcançáveis', async () => {
    const response = await fetch(new URL('/health/ready', baseUrl));
    const body = (await response.json()) as {
      checks: { name: string; status: string }[];
    };

    expect(response.status).toBe(200);
    expect(
      body.checks.map((check) => ({ name: check.name, status: check.status })),
    ).toEqual([
      { name: 'postgres', status: 'up' },
      { name: 'sqs', status: 'up' },
    ]);
  });
});
