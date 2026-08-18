import { Module } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import config from './infrastructure/database/mikro-orm.config';
import { HealthModule } from './health/health.module';
import { WageringModule } from './wagering/wagering.module';
import { OutboxModule } from './messaging/outbox.module';
import { ConsumerModule } from './messaging/consumer.module';

@Module({
  imports: [
    MikroOrmModule.forRoot(config),
    HealthModule,
    WageringModule,
    OutboxModule,
    ConsumerModule,
  ],
})
export class AppModule {}
