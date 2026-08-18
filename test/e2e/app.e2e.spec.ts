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

describe('AppController (e2e)', () => {
  it('GET / responde Hello World!', async () => {
    const response = await fetch(new URL('/', baseUrl));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('Hello World!');
  });
});