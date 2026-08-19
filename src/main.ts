import { ConsoleLogger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './api/domain-exception.filter';
import { InfrastructureExceptionFilter } from './api/infrastructure-exception.filter';
import { env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    /** JSON compacto: uma linha por evento, agregável por qualquer coletor. */
    logger: new ConsoleLogger({ json: true, colors: false, compact: true }),
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new InfrastructureExceptionFilter(),
  );

  app.enableShutdownHooks();

  await app.listen(env.port, '0.0.0.0');

  console.log(`Aplicação ouvindo em ${await app.getUrl()}`);
}

bootstrap().catch((error: unknown) => {
  console.error('Falha ao iniciar a aplicação', error);
  process.exit(1);
});
