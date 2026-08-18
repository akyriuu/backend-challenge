import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './api/domain-exception.filter';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new DomainExceptionFilter());

  app.enableShutdownHooks();

  await app.listen(env.port, '0.0.0.0');

  console.log(`Aplicação ouvindo em ${await app.getUrl()}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Falha ao iniciar a aplicação', error);
  process.exit(1);
});
